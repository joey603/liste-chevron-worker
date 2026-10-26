; Nettoie une install Windows cassée (raccourcis .lnk, exe manquant / verrouillé)
; avant que NSIS n’écrive la nouvelle version.

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "Liste Chevron.exe" /T'
  Sleep 1200

  Delete "$SMPROGRAMS\Liste Chevron.lnk"
  Delete "$DESKTOP\Liste Chevron.lnk"

  ; Permet de réécrire l’exe si un fichier fantôme / verrouillé restait
  Delete "$INSTDIR\Liste Chevron.exe"
!macroend

!macro customInstall
  Delete "$SMPROGRAMS\Liste Chevron.lnk"
  Delete "$DESKTOP\Liste Chevron.lnk"
!macroend
