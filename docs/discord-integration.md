# Discord integration

Discord delivery is optional and manual. In Settings, paste an incoming webhook URL and select Configure. Noto validates it with Discord before saving it in the operating system credential vault (Windows Credential Manager, macOS Keychain, or the desktop secret service on Linux). The full credential is never returned to React, logged, exported, or stored in SQLite/localStorage.

Generated notes show **Send to Discord**. A confirmation previews the recording title before delivery. Messages contain recording metadata, summary, key points, action items, decisions, important information, and additional context; empty sections are omitted. Content is split into ordered messages below Discord's 2,000-character content limit, with mention parsing disabled. Concurrent sends are rejected and partial failures report the completed count without changing local notes.

No bot application or channel-wide permissions are needed. Use Discord's channel Integrations screen to create an incoming webhook. Disconnect deletes the OS-vault credential.

