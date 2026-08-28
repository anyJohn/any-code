; AnyCode 自定义 NSIS 卸载钩子：卸载时弹确认删除 ~/.anycode（配置/会话/记忆）
!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 ~/.anycode 目录（配置、会话、记忆）?$\n$\n选择 [是] 彻底清理，选择 [否] 保留数据（重装可复用）。" ID_NO endAnycodeDelete
    RMDir /r "$PROFILE\.anycode"
  endAnycodeDelete:
!macroend
