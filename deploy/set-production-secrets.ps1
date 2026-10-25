# Sets the DODO website Edge Function secrets on PRODUCTION (gobsccsryhavpwqpiujz).
# PREPARED, NOT RUN. Run only with the owner's explicit approval, after production is restored and
# contact@dodotransport.com.au receives email again (docs/DNS-AND-EMAIL-CHECKLIST.md, change B).
# Secret values are typed with hidden input and are never printed, logged or written to disk.
# Usage (PowerShell, from the website folder):
#   & "./deploy/set-production-secrets.ps1"                         # Resend key + inboxes/senders/settings
#   & "./deploy/set-production-secrets.ps1" -UseExistingResendKey   # keep a RESEND_API_KEY already on production
#   & "./deploy/set-production-secrets.ps1" -WebhookSecretOnly      # the PRODUCTION Resend webhook signing secret
param(
  [switch]$WebhookSecretOnly,
  [switch]$UseExistingResendKey,
  [string]$BookingFromEmail = "DODO Bookings <bookings@dodotransport.com.au>",
  [string]$FromEmail = "DODO Transport <noreply@dodotransport.com.au>",
  [string]$Inbox = "contact@dodotransport.com.au"
)
$ErrorActionPreference = "Stop"
$Ref = "gobsccsryhavpwqpiujz"
function Invoke-Supabase([string[]]$CliArgs) { if (Get-Command supabase -ErrorAction SilentlyContinue) { & supabase $CliArgs } else { & npx --yes supabase $CliArgs } }

# Production inboxes and senders must be on the company domain: never a personal or staging test address.
if ($Inbox -notmatch '^[^@\s]+@dodotransport\.com\.au$') { throw "Production inbox must be an @dodotransport.com.au address. Nothing changed." }
foreach ($f in @($BookingFromEmail, $FromEmail)) {
  if ($f -notmatch '@dodotransport\.com\.au>?$') { throw "Sender '$f' is not on the verified domain dodotransport.com.au. Nothing changed." }
}

Push-Location $env:TEMP
try { $raw = (Invoke-Supabase @("projects", "list", "--output", "json") | Out-String) } finally { Pop-Location }
$start = $raw.IndexOf('[')
if ($start -lt 0) { throw "Could not list Supabase projects (are you logged in?). Nothing changed." }
$p = ($raw.Substring($start) | ConvertFrom-Json) | Where-Object { $_.id -eq $Ref } | Select-Object -First 1
if (-not $p -or $p.name -ne "DODO") { throw "Refusing: $Ref is not visible or not named DODO. Nothing changed." }
if ($p.status -ne "ACTIVE_HEALTHY") { throw "Refusing: production is $($p.status), not ACTIVE_HEALTHY. Nothing changed." }
Write-Host "Target project: $($p.name) ($Ref)"
$answer = Read-Host "This changes DODO PRODUCTION secrets. Type SET DODO PRODUCTION to continue"
if ($answer -cne "SET DODO PRODUCTION") { throw "Not confirmed. Nothing changed." }

function Read-Secret([string]$prompt, [string]$prefix) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  if (-not $v.StartsWith($prefix)) { throw "That value does not start with '$prefix'. Nothing changed." }
  return $v
}

if ($WebhookSecretOnly) {
  $wh = Read-Secret "PRODUCTION Resend webhook signing secret (whsec_..., input hidden)" "whsec_"
  Invoke-Supabase @("secrets", "set", "--project-ref", $Ref, "RESEND_WEBHOOK_SECRET=$wh") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Setting the webhook secret failed." }
  $wh = $null
} else {
  $settings = @("BOOKING_FROM_EMAIL=$BookingFromEmail", "WEBSITE_FROM_EMAIL=$FromEmail",
    "BOOKING_INBOX_EMAIL=$Inbox", "CONTACT_INBOX_EMAIL=$Inbox", "DRIVER_RECRUITMENT_INBOX_EMAIL=$Inbox",
    "ALLOWED_ORIGINS=https://www.dodotransport.com.au,https://dodotransport.com.au", "DODO_ENVIRONMENT=production")
  if ($UseExistingResendKey) {
    Invoke-Supabase (@("secrets", "set", "--project-ref", $Ref) + $settings) | Out-Null
  } else {
    $key = Read-Secret "PRODUCTION Resend API key with Sending access (re_..., input hidden)" "re_"
    Invoke-Supabase (@("secrets", "set", "--project-ref", $Ref, "RESEND_API_KEY=$key") + $settings) | Out-Null
    $key = $null
  }
  if ($LASTEXITCODE -ne 0) { throw "Setting secrets failed." }
}
Write-Host "Secrets now set on $Ref (names and digests only):"
Push-Location $env:TEMP
try { Invoke-Supabase @("secrets", "list", "--project-ref", $Ref) } finally { Pop-Location }
