# Runs the warranty claims test cases as simulated runs and writes a pass/fail report.
# Sheet reads are real. Slack posts, Sheet writes and approvals are answered here, so nothing is sent or written.
#
#   powershell -ExecutionPolicy Bypass -File tests\warranty-claims\run-tests.ps1
#   ... -Only 06,10      run some cases
#   ... -Repeat 3        run each case 3 times, to measure how consistent the agent is
param(
  [string[]]$Only = @(),
  [int]$Repeat = 1,
  [string]$Branch = 'main',
  [int]$TimeoutSeconds = 150
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path ([IO.Path]::GetTempPath()) ('rb-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$resultsDir = Join-Path $here 'results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null
$env:PATH = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:PATH

$cases = Get-Content -Raw -Encoding UTF8 (Join-Path $here 'cases.json') | ConvertFrom-Json
if ($Only.Count -gt 0) {
  # PowerShell can turn 06 into 6 on the way in, so compare without leading zeros.
  $wanted = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { "$_".TrimStart('0') })
  $cases = @($cases | Where-Object { $wanted -contains $_.id.TrimStart('0') })
}

function Save-Json($name, $object) {
  $path = Join-Path $work $name
  [IO.File]::WriteAllText($path, ($object | ConvertTo-Json -Depth 8 -Compress))
  return $path
}

function Invoke-Rb([string[]]$arguments) {
  $lines = & rb @arguments --json 2>$null
  $text = ($lines | Out-String).Trim()
  if (-not $text) { return $null }
  try { return $text | ConvertFrom-Json } catch { return $null }
}

function Get-Prop($object, [string]$name) {
  if ($null -eq $object) { return $null }
  $p = $object.PSObject.Properties[$name]
  if ($p) { return $p.Value }
  return $null
}

function Invoke-Case($case, [int]$attempt) {
  $seq = Get-Random -Minimum 100000 -Maximum 999999
  $ts = "1793{0}.000100" -f $seq
  $channel = 'C0CF7H58J3T'
  $event = @{ channel = $channel; user = 'U0SIM00001'; ts = $ts; userName = 'Test Technician'; text = $case.text }
  if (Get-Prop $case 'agent') { $event.user = 'U0SIM00002'; $event.userName = 'Someone Else'; $event.threadTs = '1793000000.000100' }
  $inputFile = Save-Json "input-$seq.json" $event
  $slackFile = Save-Json 'slack.json' @{ ok = $true; channel = $channel; ts = '1793999999.000200' }
  $rowFile = Save-Json 'row.json' @{ rowIndex = 2 }

  $r = @{ replies = @(); logs = @(); submits = @(); approved = 0; denied = 0; errors = @(); runUrl = '' }
  $approvals = [Collections.ArrayList]@()
  if (Get-Prop $case 'approvals') { foreach ($a in $case.approvals) { [void]$approvals.Add($a) } }
  $replies = [Collections.ArrayList]@()
  if (Get-Prop $case 'replies') { foreach ($m in $case.replies) { [void]$replies.Add($m) } }

  $agent = Get-Prop $case 'agent'
  if (-not $agent) { $agent = 'main-agent' }
  $linkFile = Save-Json 'permalink.json' @{ ok = $true; permalink = "https://example.slack.com/archives/$channel/p1793000000000100" }
  $state = Invoke-Rb @('run', 'start', 'warranty-claims', '--agent', $agent, '--input', "@$inputFile", '--branch', $Branch, '--timeout', "$TimeoutSeconds")
  if (-not $state) { $r.errors += 'rb run start returned nothing'; return $r }
  $workflowId = $state.workflowId
  $runId = $state.workflowRunId
  $r.runUrl = $state.url

  for ($step = 0; $step -lt 20; $step++) {
    if (-not $state) { $r.errors += 'rb stopped returning state'; break }
    $pending = @(Get-Prop $state 'pending')
    $pending = @($pending | Where-Object { $null -ne $_ })
    if ($pending.Count -eq 0) {
      if ($state.outcome -notin @('idle', 'finished', 'pending')) { $r.errors += "run ended with outcome '$($state.outcome)'"; break }
      if ($replies.Count -eq 0) { break }
      $text = $replies[0]; $replies.RemoveAt(0)
      $replyTs = "1793{0}.000300" -f (Get-Random -Minimum 100000 -Maximum 999999)
      $replyFile = Save-Json "reply-$seq.json" @{ channel = $channel; user = 'U0SIM00001'; ts = $replyTs; threadTs = $ts; userName = 'Test Technician'; text = $text }
      $state = Invoke-Rb @('run', 'send', $workflowId, $runId, '--event', 'message', '--connection', 'slack', '--input', "@$replyFile", '--timeout', "$TimeoutSeconds")
      continue
    }

    $call = $pending[0]
    $id = $call.toolCallId
    if ($call.kind -eq 'tool_call' -and $call.toolName -eq 'submit_claim') {
      $r.submits += $call.input
      $decision = $null
      if ($approvals.Count -gt 0) { $decision = $approvals[0]; $approvals.RemoveAt(0) }
      $denyReason = Get-Prop $decision 'deny'
      if ($denyReason) {
        $r.denied++
        $state = Invoke-Rb @('run', 'answer', $workflowId, $runId, '--call', $id, '--deny', '--reason', $denyReason, '--timeout', "$TimeoutSeconds")
      } else {
        $r.approved++
        $result = Save-Json "claim-$seq.json" @{ status = 'submitted'; claimId = "WC-TEST$($case.id)" }
        $state = Invoke-Rb @('run', 'answer', $workflowId, $runId, '--call', $id, '--result', "@$result", '--timeout', "$TimeoutSeconds")
      }
    } elseif ($call.kind -eq 'integration_action' -and $call.actionId -eq 'send-message') {
      $r.replies += [string]$call.params.text
      $state = Invoke-Rb @('run', 'answer', $workflowId, $runId, '--call', $id, '--result', "@$slackFile", '--timeout', "$TimeoutSeconds")
    } elseif ($call.kind -eq 'integration_action' -and $call.actionId -eq 'get-permalink') {
      $r.opened = $true
      $state = Invoke-Rb @('run', 'answer', $workflowId, $runId, '--call', $id, '--result', "@$linkFile", '--timeout', "$TimeoutSeconds")
    } elseif ($call.kind -eq 'integration_action' -and $call.actionId -eq 'append-row') {
      $r.logs += $call.params.values
      $state = Invoke-Rb @('run', 'answer', $workflowId, $runId, '--call', $id, '--result', "@$rowFile", '--timeout', "$TimeoutSeconds")
    } else {
      $r.errors += "unexpected pending call: $($call.kind) $($call.toolName)$($call.actionId)"
      break
    }
  }

  & rb run stop $workflowId $runId 2>$null | Out-Null
  return $r
}

function Test-Case($case, $r) {
  $failures = @($r.errors)
  $e = $case.expect
  $replyText = ($r.replies -join "`n")

  if ($r.approved -ne [int]$e.approved) { $failures += "approved $($r.approved) claim(s), expected $($e.approved)" }
  $wantDenied = Get-Prop $e 'denied'
  if ($null -eq $wantDenied) { $wantDenied = 0 }
  if ($r.denied -ne [int]$wantDenied) { $failures += "denied $($r.denied) time(s), expected $wantDenied" }

  $wantLog = Get-Prop $e 'logStatus'
  $log = $null
  if ($r.logs.Count -gt 0) { $log = $r.logs[-1] }
  if ($wantLog) {
    if (-not $log) { $failures += "no decision logged, expected '$wantLog'" }
    elseif ($log.Status -ne $wantLog) { $failures += "logged '$($log.Status)', expected '$wantLog'" }
  } elseif ($log) { $failures += "logged '$($log.Status)', expected no log row" }

  $reasonMatch = Get-Prop $e 'logReasonMatch'
  if ($reasonMatch -and $log -and $log.Reason -notmatch $reasonMatch) { $failures += "reason '$($log.Reason)' doesn't match '$reasonMatch'" }

  $replyMatch = Get-Prop $e 'replyMatch'
  if ($replyMatch -and $replyText -notmatch $replyMatch) { $failures += "no reply matching '$replyMatch'" }
  if ($r.replies.Count -eq 0) { $failures += 'the technician got no reply' }
  if (-not (Get-Prop $case 'agent') -and -not $r.opened) { $failures += 'open_claim was not called, so the thread is not registered' }
  if ($r.approved + $r.denied -gt 0 -and $replyText -notmatch 'Approval needed') { $failures += 'no approval request was posted in the thread' }
  # The agent must not invent a contact or next step. "A person will follow up" is the only one the prompt allows.
  if ($replyText -match 'administrator|contact |reach out|your manager|supervisor|service advisor') { $failures += "reply invents a next step: $replyText" }

  $replyNotMatch = Get-Prop $e 'replyNotMatch'
  if ($replyNotMatch -and $replyText -match $replyNotMatch) { $failures += "reply contains '$($Matches[0])'" }
  $submitNotMatch = Get-Prop $e 'submitNotMatch'
  if ($submitNotMatch) {
    foreach ($s in $r.submits) {
      if ("$($s.failureDescription) $($s.repairPerformed)" -match $submitNotMatch) { $failures += "claim text contains '$($Matches[0])'" }
    }
  }
  $logNotMatch = Get-Prop $e 'logNotMatch'
  if ($logNotMatch -and $log) {
    foreach ($column in 'Failure Description', 'Reason') {
      if ("$(Get-Prop $log $column)" -match $logNotMatch) { $failures += "$column would run as a formula: $(Get-Prop $log $column)" }
    }
  }

  $wantSubmit = Get-Prop $e 'submit'
  if ($wantSubmit) {
    if ($r.submits.Count -eq 0) { $failures += 'no claim reached approval' }
    else {
      $last = $r.submits[-1]
      foreach ($p in $wantSubmit.PSObject.Properties) {
        $got = Get-Prop $last $p.Name
        if ("$got" -ne "$($p.Value)") { $failures += "$($p.Name) was '$got', expected '$($p.Value)'" }
      }
    }
  }
  return ,$failures
}

$rows = @()
$passed = 0
$total = 0
foreach ($case in $cases) {
  for ($attempt = 1; $attempt -le $Repeat; $attempt++) {
    $total++
    $r = Invoke-Case $case $attempt
    $failures = Test-Case $case $r
    $ok = $failures.Count -eq 0
    if ($ok) { $passed++ }
    $label = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Output ("{0} {1} {2}" -f $label, $case.id, $case.name)
    foreach ($f in $failures) { Write-Output "     $f" }
    $rows += [pscustomobject]@{
      id = $case.id; group = $case.group; name = $case.name; attempt = $attempt; result = $label
      needs = (Get-Prop $case 'needs'); failures = $failures; replies = $r.replies; run = $r.runUrl
    }
  }
}

$rate = if ($total -gt 0) { [Math]::Round(100 * $passed / $total, 1) } else { 0 }
$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')
$md = @("# Warranty claims test results", '', "Run $stamp against the latest draft on branch ``$Branch``.", '', "**$passed of $total passed ($rate%).**", '', '| Test | Group | Scenario | Result | Notes |', '|---|---|---|---|---|')
foreach ($row in $rows) {
  $notes = ($row.failures -join '; ') -replace '\|', '/'
  if ($row.result -eq 'FAIL' -and $row.needs) { $notes = "Needs $($row.needs). $notes" }
  $md += "| [$($row.id)]($($row.run)) | $($row.group) | $($row.name) | $($row.result) | $notes |"
}
[IO.File]::WriteAllText((Join-Path $resultsDir 'latest.md'), ($md -join "`n") + "`n")
[IO.File]::WriteAllText((Join-Path $resultsDir 'latest.json'), ($rows | ConvertTo-Json -Depth 6))
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Output ''
Write-Output "$passed of $total passed ($rate%). Report: $(Join-Path $resultsDir 'latest.md')"
if ($passed -ne $total) { exit 1 }
exit 0
