; B-Z installer theme: dark, same palette as the app.
; Upgrades are automatic: the fixed appId/guid makes a new Setup replace any older B-Z in place.
; electron-builder may already define some MUI_* values, so every define is un-defined first.

!macro bzDef NAME VALUE
  !ifdef ${NAME}
    !undef ${NAME}
  !endif
  !define ${NAME} "${VALUE}"
!macroend

!macro customHeader
  !insertmacro bzDef MUI_BGCOLOR "09090A"
  !insertmacro bzDef MUI_TEXTCOLOR "ECEBE6"
  BrandingText "B-Z  -  AI network doctor"
!macroend

!macro customWelcomePage
  !insertmacro bzDef MUI_WELCOMEPAGE_TITLE "Your connection, diagnosed."
  !insertmacro bzDef MUI_WELCOMEPAGE_TEXT "B-Z scans your adapters, router, DNS and internet, asks Claude what is actually wrong, then fixes it.$\r$\n$\r$\nIf B-Z is already installed, this setup updates it and keeps your settings.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend
