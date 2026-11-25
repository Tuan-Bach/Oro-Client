@echo off
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0dist\electron\main.js"
exit
