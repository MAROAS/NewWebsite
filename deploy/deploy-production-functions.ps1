# Deploys the four DODO website Edge Functions to PRODUCTION (gobsccsryhavpwqpiujz).
# PREPARED, NOT RUN. Run only with the owner's explicit approval, after production is restored and secured,
# and after the three production website migrations are applied (docs/PRODUCTION-PLAN.md).
# Usage (PowerShell, from the website folder):  & "./deploy/deploy-production-functions.ps1"
# The website forms stay closed after this: they open only when site-config.js is switched on and
# productionFormsVerified is set to true after the production form tests pass.
$ErrorActionPreference = "Stop"
$Ref = "gobsccsryhavpwqpiujz"
$StagingRef = "ziqwynsljjxlxuhjaeja"
$Functions = @("website-booking-request", "website-contact-message", "website-driver-application", "resend-email-events")
$Site = Split-Path -Parent $PSScriptRoot

function Invoke-Supabase([string[]]$CliArgs) { if (Get-Command supabase -ErrorAction SilentlyContinue) { & supabase $CliArgs } else { & npx --yes supabase $CliArgs } }

foreach ($fn in $Functions) {
  if (-not (Test-Path "$Site\supabase\functions\$fn\index.ts")) { throw "Missing supabase\functions\$fn\index.ts. Nothing deployed." }
}

Push-Location $env:TEMP
try { $raw = (Invoke-Supabase @("projects", "list", "--output", "json") | Out-String) } finally { Pop-Location }
$start = $raw.IndexOf('[')
if ($start -lt 0) { throw "Could not list Supabase projects (are you logged in?). Nothing deployed." }
$p = ($raw.Substring($start) | ConvertFrom-Json) | Where-Object { $_.id -eq $Ref } | Select-Object -First 1
if (-not $p) { throw "Project $Ref is not visible to this Supabase login. Nothing deployed." }
Write-Host "Target project: $($p.name) ($Ref), status $($p.status)"
if ($Ref -eq $StagingRef) { throw "Refusing: that is DODO-Staging. Nothing deployed." }
if ($p.name -ne "DODO") { throw "Refusing: project $Ref is named '$($p.name)', not DODO. Nothing deployed." }
if ($p.status -ne "ACTIVE_HEALTHY") { throw "Refusing: production is $($p.status), not ACTIVE_HEALTHY (restore it first). Nothing deployed." }

# Before confirming: the three production website migrations must already be applied (PRODUCTION-PLAN.md).
$answer = Read-Host "This deploys to DODO PRODUCTION. Type DEPLOY DODO PRODUCTION to continue"
if ($answer -cne "DEPLOY DODO PRODUCTION") { throw "Not confirmed. Nothing deployed." }

Push-Location $Site
try {
  foreach ($fn in $Functions) {
    Write-Host "Deploying $fn ..."
    Invoke-Supabase @("functions", "deploy", $fn, "--project-ref", $Ref, "--no-verify-jwt", "--use-api")
    if ($LASTEXITCODE -ne 0) { throw "Deploy of $fn failed (exit $LASTEXITCODE). Functions deployed before it stay deployed; forms remain closed on the website." }
  }
} finally { Pop-Location }
Push-Location $env:TEMP
try { Invoke-Supabase @("functions", "list", "--project-ref", $Ref) } finally { Pop-Location }
Write-Host "Done. Next: set the production secrets (set-production-secrets.ps1), then run the production form tests."
