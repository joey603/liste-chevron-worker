; Nettoie une install Windows cassée, puis recrée les raccourcis
; avec $OUTDIR = dossier de l’app (sinon Windows : "The parameter is incorrect").

!macro customInit
  nsExec::ExecToLog 'taskkill /F /IM "Liste Chevron.exe" /T'
  Sleep 1200

  SetShellVarContext current
  Delete "$SMPROGRAMS\Liste Chevron.lnk"
  Delete "$DESKTOP\Liste Chevron.lnk"

  Delete "$INSTDIR\Liste Chevron.exe"
!macroend

!macro customInstall
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  CreateShortCut "$DESKTOP\Liste Chevron.lnk" "$INSTDIR\Liste Chevron.exe" "" "$INSTDIR\Liste Chevron.exe" 0
  CreateShortCut "$SMPROGRAMS\Liste Chevron.lnk" "$INSTDIR\Liste Chevron.exe" "" "$INSTDIR\Liste Chevron.exe" 0

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
