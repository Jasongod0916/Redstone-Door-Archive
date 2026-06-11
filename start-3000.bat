@echo off
cd /d "%~dp0"
bun run build
bun run start -- -p 3000
