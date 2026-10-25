# Deploys the four DODO website Edge Functions to DODO-Staging ONLY. Run only after owner approval.
# Usage (PowerShell, from the website folder):  & "./deploy/deploy-staging-functions.ps1"
# Needs the Supabase CLI logged in (installed globally, or run once through npx: npx supabase login).
$ErrorActionPreference = "Stop"
$Ref = "ziqwynsljjxlxuhjaeja"
$Functions = @("website-booking-request", "website-contact-message", "website-driver-application", "resend-email-events")
$Site = Split-Path -Parent $PSScriptRoot   # the "Website DODO" folder (contains supabase\)

# Use the installed CLI if there is one, otherwise the npx copy.
# Arguments are passed as one explicit array (PowerShell's @args forwarding loses them when calling npx).
function Invoke-Supabase([string[]]$CliArgs) { if (Get-Command supabase -ErrorAction SilentlyContinue) { & supabase $CliArgs } else { & npx --yes supabase $CliArgs } }

foreach ($fn in $Functions) {
  if (-not (Test-Path "$Site\supabase\functions\$fn\index.ts")) { throw "Missing supabase\functions\$fn\index.ts" }
}

# Confirm the target is DODO-Staging before touching anything (listed from a neutral folder).
Push-Location $env:TEMP
try { $raw = (Invoke-Supabase @("projects", "list", "--output", "json") | Out-String) } finally { Pop-Location }
$start = $raw.IndexOf('[')
if ($start -lt 0) { throw "Could not list Supabase projects (are you logged in?). Nothing deployed." }
$p = ($raw.Substring($start) | ConvertFrom-Json) | Where-Object { $_.id -eq $Ref } | Select-Object -First 1
if (-not $p) { throw "Project $Ref is not visible to this Supabase login. Nothing deployed." }
Write-Host "Target project: $($p.name) ($Ref), status $($p.status)"
if ($p.name -ne "DODO-Staging") { throw "Refusing: project $Ref is named '$($p.name)', not DODO-Staging. Nothing deployed." }

Push-Location $Site
try {
  foreach ($fn in $Functions) {
    Write-Host "Deploying $fn ..."
    Invoke-Supabase @("functions", "deploy", $fn, "--project-ref", $Ref, "--no-verify-jwt", "--use-api")
    if ($LASTEXITCODE -ne 0) { throw "Deploy of $fn failed (exit $LASTEXITCODE). Functions deployed before it stay deployed; see the runbook to remove them." }
  }
} finally { Pop-Location }
Push-Location $env:TEMP
try { Invoke-Supabase @("functions", "list", "--project-ref", $Ref) } finally { Pop-Location }
Write-Host "Done. Expected: the four functions listed as ACTIVE on $Ref."
