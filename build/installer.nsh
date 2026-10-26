; Nettoie une install Windows cassée AVANT la copie des fichiers.
; Ne pas supprimer les raccourcis dans customInstall : NSIS les crée
; juste avant, et runAfterFinish s’en sert pour relancer l’app.

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "Liste Chevron.exe" /T'
  Sleep 1200

  Delete "$SMPROGRAMS\Liste Chevron.lnk"
  Delete "$DESKTOP\Liste Chevron.lnk"

  ; Permet de réécrire l’exe si un fichier fantôme / verrouillé restait
  Delete "$INSTDIR\Liste Chevron.exe"
!macroend
