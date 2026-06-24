@echo off
REM Build the Seerr TV APK. Usage:
REM   build.bat            -> signed release APK
REM   build.bat debug      -> debug APK
setlocal
cd /d "%~dp0"
if not defined JAVA_HOME set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.16.8-hotspot"

if /i "%1"=="debug" (
    call gradlew.bat assembleDebug
    echo.
    echo APK: app\build\outputs\apk\debug\app-debug.apk
) else (
    call gradlew.bat assembleRelease
    echo.
    echo APK: app\build\outputs\apk\release\app-release.apk
)
endlocal
