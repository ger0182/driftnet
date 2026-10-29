# Railway 部署（GitHub + Railway + Volume）

這個 fork 的根目錄 `Dockerfile` 已調整為：

- 直接從 **目前這個 GitHub repository 的原始碼**建置 driftnet。
- 預設啟動 Web 服務（`driftnet start`）。
- 預設 `DRIFTNET_HOME=/data`，SQLite、設定與快取都可以放在 Railway Volume。
- 預設監聽 `0.0.0.0`，適合 Railway 的公開網路。

## 1. 建立 Railway Service

1. 在 Railway 建立 Project。
2. 選擇 **Deploy from GitHub repo**。
3. 選擇 `ger0182/driftnet`。
4. Branch 選 `main`。
5. Railway 會自動偵測根目錄的 `Dockerfile`，不需要另外設定 Build Command 或 Start Command。

> 不需要手動設定 `PORT`。driftnet 會直接讀 Railway 提供的 `PORT`。

## 2. 建立 Volume

在 driftnet Service 新增 Volume：

```text
Mount Path: /data
```

這樣資料會保存在：

```text
/data/driftnet.db
/data/.env
/data/media/
```

重新部署或重新啟動 Service 時，Volume 裡的資料不會跟著容器消失。

## 3. Railway Variables

至少建議加入：

```dotenv
DRIFTNET_ACCESS=private
DRIFTNET_TOKEN=<請產生一組長且隨機的密碼>
DRIFTNET_LANGUAGE=Traditional Chinese (Taiwan)
DRIFTNET_LOCALE=zh-TW
DRIFTNET_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

`DRIFTNET_HOME=/data`、`DRIFTNET_HOST=0.0.0.0`、`DRIFTNET_OPEN=0` 已經寫在 Docker image 預設值裡，不需要重複設定。

### AI 摘要（選用）

例如使用 OpenAI-compatible API：

```dotenv
DRIFTNET_LLM_PROVIDER=openai
DRIFTNET_LLM_MODEL=<model-name>
DRIFTNET_LLM_API_KEY=<api-key>
DRIFTNET_LLM_BASE_URL=<只有非 OpenAI 官方端點時才需要>
```

也可以完全不設定模型；driftnet 仍可收藏與搜尋連結，只是不會由 LLM 自動摘要／分類。

> `DRIFTNET_TOKEN`、`DRIFTNET_LLM_API_KEY` 等敏感值只放 Railway Variables，不要 commit 到 GitHub。

## 4. 開啟公開網址

Railway Service → **Settings → Networking** → Generate Domain。

完成後可用 Railway 提供的網址開啟 driftnet。因為預設建議使用：

```text
DRIFTNET_ACCESS=private
```

第一次開啟時需要輸入 `DRIFTNET_TOKEN`。

## 5. 確認 Volume 正常

Deploy Logs 正常啟動時應看到類似：

```text
driftnet on http://0.0.0.0:<PORT>
data: /data/driftnet.db
```

新增一筆收藏後重新部署 Service；資料仍存在就代表 Volume 設定正確。

## 6. 備份

Railway Volume 可以透過 Railway 的 Volume 管理／備份功能保存資料。

核心資料檔是：

```text
/data/driftnet.db
```

如果要做額外離線備份，優先備份整個 `/data`，這樣 SQLite、設定與相關資料可以一起保留。

## 架構

```text
GitHub: ger0182/driftnet
          │
          │ push main
          ▼
       Railway
          │
   ┌──────┴──────┐
   │             │
driftnet       Volume
Web/API/MCP     /data
   │             │
   │        driftnet.db
   ▼
Railway Domain
```

之後 GitHub `main` 有新的 commit，Railway 可以自動重新建置並部署；收藏資料則留在 Volume，不會存在 Git repository 裡。
