@echo off
echo ================================================
echo   SolCrush On-Chain - Push to GitHub
echo ================================================
echo.
set /p GITHUB_USERNAME=Enter your GitHub username: 
set /p GITHUB_TOKEN=Enter your GitHub token (github.com/settings/tokens): 
echo.
echo Pushing to GitHub...
git init
git add .
git commit -m "SolCrush On-Chain Staking - Full System"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://%GITHUB_USERNAME%:%GITHUB_TOKEN%@github.com/%GITHUB_USERNAME%/solcrush.git
git push -u origin main --force
echo.
echo ================================================
echo Done! Now deploy the Anchor program:
echo   1. Install Anchor: https://anchor-lang.com
echo   2. Run: scripts/deploy.sh
echo   3. Set NEXT_PUBLIC_PROGRAM_ID in frontend/.env.local
echo   4. Connect Vercel to this repo (root dir = frontend)
echo ================================================
pause
