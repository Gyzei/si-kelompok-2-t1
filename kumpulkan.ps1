param(
    [string]$Semester = '20261',
    [switch]$Refresh
)
$collectorArguments = @('--use-system-ca', (Join-Path $PSScriptRoot 'scripts\collect.mjs'), '--semester', $Semester)
if ($Refresh) { $collectorArguments += '--refresh' }
& node @collectorArguments
exit $LASTEXITCODE
