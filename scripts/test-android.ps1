param([string]$JavaHome, [string]$SdkRoot, [string]$ProxyUri, [string]$GradleHome)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($JavaHome) { $env:JAVA_HOME = $JavaHome }
if ($SdkRoot) { $env:ANDROID_HOME = $SdkRoot }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem -LiteralPath "$env:USERPROFILE/.cache/tsport-android/java" -Directory | Select-Object -First 1).FullName }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "$env:USERPROFILE/.cache/tsport-android/sdk" }
if (-not $GradleHome -and (Test-Path -LiteralPath "$env:USERPROFILE/.cache/tsport-android/gradle/gradle-8.14.3/bin/gradle.bat")) { $GradleHome = "$env:USERPROFILE/.cache/tsport-android/gradle/gradle-8.14.3" }
# Gradle's Windows test worker cannot load classes through this host's non-ASCII paths.
# Use a cache junction to the same checkout; do not copy, move or delete project files.
$testRoot = $projectRoot
if ($projectRoot -match '[^\x00-\x7F]') {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $suffix = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot)))).Replace('-', '').Substring(0, 12) }
  finally { $hasher.Dispose() }
  $linkParent = "$env:USERPROFILE/.cache/tsport-android/test-workspaces"
  New-Item -ItemType Directory -Path $linkParent -Force | Out-Null
  $testRoot = Join-Path $linkParent $suffix
  if (Test-Path -LiteralPath $testRoot) {
    $existing = Get-Item -LiteralPath $testRoot
    if ($existing.LinkType -ne 'Junction' -or $existing.Target -ne $projectRoot) { throw 'Test cache path does not point to this checkout.' }
  } else { New-Item -ItemType Junction -Path $testRoot -Target $projectRoot | Out-Null }
}
$networkArgs = @()
if ($ProxyUri) {
  $proxyAddress = [uri]$ProxyUri
  $networkArgs = @("-Dhttps.proxyHost=$($proxyAddress.Host)", "-Dhttps.proxyPort=$($proxyAddress.Port)", "-Dhttp.proxyHost=$($proxyAddress.Host)", "-Dhttp.proxyPort=$($proxyAddress.Port)")
}
Push-Location -LiteralPath "$testRoot/android"
try {
  if ($GradleHome) { & "$GradleHome/bin/gradle.bat" @networkArgs ':app:testDebugUnitTest' '--console=plain' }
  else { & .\gradlew.bat @networkArgs ':app:testDebugUnitTest' '--console=plain' }
  if ($LASTEXITCODE -ne 0) { throw 'Native Android tests failed.' }
} finally { Pop-Location }
