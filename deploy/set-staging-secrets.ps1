# Sets the DODO-Staging Edge Function secrets. Run only after owner approval.
# Secret values are typed with hidden input and are never printed, logged or written to disk.
# Usage:
#   & ".\deploy\set-staging-secrets.ps1" -Inbox <test inbox> [-UseExistingResendKey]   # inboxes/sender/settings
#   & ".\deploy\set-staging-secrets.ps1" -WebhookSecretOnly  # later: the Resend webhook signing secret
# Senders must be on the verified Resend domain dodotransport.com.au (booking emails: bookings@, others: noreply@).
param(
  [switch]$WebhookSecretOnly,
  [switch]$UseExistingResendKey,   # keep the RESEND_API_KEY already on staging (also used by admin invitations)
  [string]$BookingFromEmail = "DODO Bookings <bookings@dodotransport.com.au>",
  [string]$FromEmail = "DODO Transport <noreply@dodotransport.com.au>",
  [string]$Inbox = ""              # staging test inbox for all three forms; required unless -WebhookSecretOnly
)
$ErrorActionPreference = "Stop"
$Ref = "ziqwynsljjxlxuhjaeja"
# Arguments are passed as one explicit array (PowerShell's @args forwarding loses them when calling npx).
function Invoke-Supabase([string[]]$CliArgs) { if (Get-Command supabase -ErrorAction SilentlyContinue) { & supabase $CliArgs } else { & npx --yes supabase $CliArgs } }
if (-not $WebhookSecretOnly -and $Inbox -notmatch '^[^@\s]+@[^@\s]+\.[a-z]{2,}$') { throw "Give the staging test inbox with -Inbox <address>. Nothing changed." }
foreach ($f in @($BookingFromEmail, $FromEmail)) {
  if ($f -notmatch '@dodotransport\.com\.au>?$') { throw "Sender '$f' is not on the verified domain dodotransport.com.au. Nothing changed." }
}

Push-Location $env:TEMP
try { $raw = (Invoke-Supabase @("projects", "list", "--output", "json") | Out-String) } finally { Pop-Location }
$start = $raw.IndexOf('[')
if ($start -lt 0) { throw "Could not list Supabase projects (are you logged in?). Nothing changed." }
$p = ($raw.Substring($start) | ConvertFrom-Json) | Where-Object { $_.id -eq $Ref } | Select-Object -First 1
if (-not $p -or $p.name -ne "DODO-Staging") { throw "Refusing: $Ref is not visible or not named DODO-Staging. Nothing changed." }
Write-Host "Target project: $($p.name) ($Ref)"

function Read-Secret([string]$prompt, [string]$prefix) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
  if (-not $v.StartsWith($prefix)) { throw "That value does not start with '$prefix'. Nothing changed." }
  return $v
}

if ($WebhookSecretOnly) {
  $wh = Read-Secret "Resend webhook signing secret (whsec_..., input hidden)" "whsec_"
  Invoke-Supabase @("secrets", "set", "--project-ref", $Ref, "RESEND_WEBHOOK_SECRET=$wh") | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Setting the webhook secret failed." }
  $wh = $null
} else {
  $settings = @("BOOKING_FROM_EMAIL=$BookingFromEmail",
    "WEBSITE_FROM_EMAIL=$FromEmail",
    "BOOKING_INBOX_EMAIL=$Inbox", "CONTACT_INBOX_EMAIL=$Inbox", "DRIVER_RECRUITMENT_INBOX_EMAIL=$Inbox",
    "ALLOWED_ORIGINS=http://localhost:8080", "DODO_ENVIRONMENT=staging")
  if ($UseExistingResendKey) {
    Invoke-Supabase (@("secrets", "set", "--project-ref", $Ref) + $settings) | Out-Null
  } else {
    $key = Read-Secret "Resend API key with Sending access (re_..., input hidden)" "re_"
    Invoke-Supabase (@("secrets", "set", "--project-ref", $Ref, "RESEND_API_KEY=$key") + $settings) | Out-Null
    $key = $null
  }
  if ($LASTEXITCODE -ne 0) { throw "Setting secrets failed." }
}
Write-Host "Secrets now set on $Ref (names and digests only):"
Push-Location $env:TEMP
try { Invoke-Supabase @("secrets", "list", "--project-ref", $Ref) } finally { Pop-Location }
