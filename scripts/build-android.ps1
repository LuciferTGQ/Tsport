param([string]$JavaHome, [string]$SdkRoot, [string]$ProxyUri, [string]$GradleHome)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ($JavaHome) { $env:JAVA_HOME = $JavaHome }
if ($SdkRoot) { $env:ANDROID_HOME = $SdkRoot }
if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath "$env:USERPROFILE/.cache/tsport-android/java")) {
  $env:JAVA_HOME = (Get-ChildItem -LiteralPath "$env:USERPROFILE/.cache/tsport-android/java" -Directory | Select-Object -First 1).FullName
}
if (-not $env:ANDROID_HOME -and (Test-Path -LiteralPath "$env:USERPROFILE/.cache/tsport-android/sdk/platforms")) { $env:ANDROID_HOME = "$env:USERPROFILE/.cache/tsport-android/sdk" }
if (-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) { throw 'Set JAVA_HOME (JDK 21) and ANDROID_HOME (SDK 36), or pass -JavaHome and -SdkRoot.' }
if (-not $GradleHome -and (Test-Path -LiteralPath "$env:USERPROFILE/.cache/tsport-android/gradle/gradle-8.14.3/bin/gradle.bat")) { $GradleHome = "$env:USERPROFILE/.cache/tsport-android/gradle/gradle-8.14.3" }
$sdkLine = 'sdk.dir=' + $env:ANDROID_HOME.Replace('\','/')
Set-Content -LiteralPath "$projectRoot/android/local.properties" -Value $sdkLine -Encoding ascii
& npm.cmd run android:sync
if ($LASTEXITCODE -ne 0) { throw 'Web build or Android sync failed.' }
Push-Location -LiteralPath "$projectRoot/android"
try {
  $networkArgs = @()
  if ($ProxyUri) {
    $proxyAddress = [uri]$ProxyUri
    $networkArgs = @("-Dhttps.proxyHost=$($proxyAddress.Host)", "-Dhttps.proxyPort=$($proxyAddress.Port)", "-Dhttp.proxyHost=$($proxyAddress.Host)", "-Dhttp.proxyPort=$($proxyAddress.Port)")
  }
  if ($GradleHome) { & "$GradleHome/bin/gradle.bat" @networkArgs assembleDebug --console=plain }
  else { & .\gradlew.bat @networkArgs assembleDebug --console=plain }
  if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
} finally { Pop-Location }
New-Item -ItemType Directory -Path "$projectRoot/releases" -Force | Out-Null
$appVersion = (Get-Content -LiteralPath "$projectRoot/package.json" -Raw | ConvertFrom-Json).version
$apkPath = "$projectRoot/releases/Tsport-$appVersion-debug.apk"
Copy-Item -LiteralPath "$projectRoot/android/app/build/outputs/apk/debug/app-debug.apk" -Destination $apkPath -Force
$apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$apkPath.sha256" -Value "$apkHash  Tsport-$appVersion-debug.apk" -Encoding ascii
Write-Output "APK ready: $apkPath"
