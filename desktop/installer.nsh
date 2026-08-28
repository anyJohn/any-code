; AnyCode 自定义 NSIS 卸载钩子：卸载时弹确认是否保留 ~/.anycode
!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "是否保留用户数据（~/.anycode：配置、会话、记忆）?$\n$\n选择 [是] 保留数据（重装可复用），选择 [否] 彻底删除。" IDYES endAnycodeDelete
    RMDir /r "$PROFILE\.anycode"
  endAnycodeDelete:
!macroend
