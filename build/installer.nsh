; B-Z installer theme: dark, same palette as the app.
; Upgrades are automatic: the fixed appId/guid makes a new Setup replace any older B-Z in place.

!macro customHeader
  !define MUI_BGCOLOR 09090A
  !define MUI_TEXTCOLOR ECEBE6
  BrandingText "B-Z  ·  AI network doctor"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Your connection, diagnosed."
  !define MUI_WELCOMEPAGE_TEXT "B-Z scans your adapters, router, DNS and internet, asks Claude what is actually wrong, then fixes it.$\r$\n$\r$\nIf B-Z is already installed, this setup updates it and keeps your settings.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "B-Z is ready."
  !define MUI_FINISHPAGE_TEXT "Run a scan whenever your internet feels off. B-Z asks for administrator rights because most fixes (DNS, adapter restart, resets) need them."
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !define MUI_FINISHPAGE_RUN_TEXT "Launch B-Z"
  !insertmacro MUI_PAGE_FINISH
!macroend
