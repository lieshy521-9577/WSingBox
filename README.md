# SingBox Client

A lightweight Windows GUI client for [sing-box](https://sing-box.sagernet.org/) proxy platform, built with Tauri 2 + React + TypeScript.

## Features

- Import sing-box JSON configuration files with automatic 1.12.0 compatibility fixes
- Auto-extract proxy nodes and profiles (selector/urltest groups) from config
- Auto-select active node based on profile hierarchy (selector -> urltest -> node)
- Start/stop sing-box core with admin elevation (UAC) for TUN mode support
- Mixed inbound (HTTP/SOCKS5 on 127.0.0.1:7890) auto-injected as fallback
- Automatic Windows system proxy setup and cleanup
- TCP connection latency testing for all nodes
- Config overview panel showing inbounds, outbounds, DNS, routes, rule sets
- Dark themed modern UI with custom titlebar

## Architecture

```
SingBox/
├── src/                    # React frontend
│   ├── components/         # UI components (Sidebar, NodeList, ProxyControl, etc.)
│   ├── hooks/              # useSingbox state management hook
│   └── types/              # TypeScript interfaces
├── src-tauri/              # Rust backend (Tauri 2)
│   └── src/
│       ├── commands/       # IPC commands (config, singbox, proxy, latency)
│       └── singbox/        # Process management module
├── bin/                    # sing-box binary (v1.12.0)
└── package.json
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons
- **Backend**: Rust, Tauri 2
- **Proxy Core**: sing-box 1.12.0
- **Build**: Vite, Cargo

## Prerequisites

- Node.js >= 18
- Rust toolchain (stable)
- Windows 10/11 with WebView2 runtime
- sing-box binary in `bin/` directory

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build release binary
npm run tauri build
```

## Usage

1. Launch the application
2. Click "Import Config" in the sidebar and select your sing-box JSON config file
3. The config will be auto-sanitized for sing-box 1.12.0 compatibility
4. Nodes and profiles are extracted and displayed automatically
5. Click "Start" to launch sing-box (UAC prompt for TUN privileges)
6. System proxy is set automatically to 127.0.0.1:7890
7. Click "Stop" to terminate sing-box and clear system proxy

## Supported Protocols

- VLESS (with Reality, XTLS-Vision, WebSocket transport)
- VMess
- Shadowsocks
- Trojan
- Hysteria2
- TUIC
- WireGuard

## Config Compatibility

The client automatically fixes older config formats for sing-box 1.12.0:

- Removes `strategy` from individual DNS servers (moved to DNS top-level)
- Removes `type: "block"` DNS servers (deprecated)
- Removes `sniff_override_destination` from route rule sniff actions
- Adds `mixed` inbound on port 7890 if not present

## License

MIT
