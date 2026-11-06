# dsh-session-bridge

给 Host 之外的脚本/agent 开的 DSH 入口：列出工作区、在工作区里新建会话、发第一条消息。
会话是正常的工作区成员，建完在 Web 侧边栏可见，可以直接接着聊。

## 安装

需要 DSH 的 `web` profile 和 `0.2.2-rc.1` 或兼容版本。

```bash
dsh plugin --profile web add github:Sunhelter/dsh-session-bridge
```

装完重启一次 Harness。卸载：

```bash
dsh plugin --profile web remove @local/dsh-session-bridge
```

## 配置

| 键 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `token` | `DSH_SESSION_BRIDGE_TOKEN` | 空 | 共享密钥，空则两个接口都不启用 |

优先级：bundle config > `session-bridge.local.json` > 环境变量。

```bash
openssl rand -hex 32   # 生成 token
```

## 用法

```bash
curl -s -H "Authorization: Bearer $DSH_TOKEN" \
  http://127.0.0.1:3080/plugins/session-bridge/workspaces
```

```bash
curl -s -X POST -H "Authorization: Bearer $DSH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"workspace-…","message":"帮我写一份周报"}' \
  http://127.0.0.1:3080/plugins/session-bridge/sessions
```

响应 `{ ok: true, sessionId, reused }`；之后到 Web 里打开这个会话即可。
挂在反向代理后面时同理，取决于客户端能否解析域名并信任证书。

## 安全

接口只认 token，能建会话就能让模型在工作区里跑工具，相当于本机的一份写权限。
只在可信网络里开，不要暴露到公网。
