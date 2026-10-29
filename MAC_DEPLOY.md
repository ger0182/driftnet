# Mac 長期部署：Docker Compose + Cloudflare Tunnel

本專案目前推薦以 **Mac + Docker Desktop + Cloudflare Tunnel** 長期運作。`Dockerfile` 會直接從這個 repository 的原始碼建置 driftnet，不會改裝 npm registry 上的套件。Railway 方式仍保留在 [RAILWAY.md](RAILWAY.md)，但不是本文件的主要部署方式。

## 1. 安裝 Docker Desktop

從 [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) 安裝符合 Mac 晶片的版本，啟動 Docker Desktop，等待狀態顯示 Docker Engine 已運作，再確認：

```bash
docker --version
docker compose version
```

不需要設定路由器 port forwarding。Compose 只把 `8787` 綁到 Mac 的 loopback 位址 `127.0.0.1`；外部流量只走 Cloudflare Tunnel。

## 2. Clone repository

```bash
git clone https://github.com/ger0182/driftnet.git
cd driftnet
```

## 3. 建立 `.env`

```bash
cp .env.mac.example .env
```

先產生管理密碼：

```bash
openssl rand -base64 32
```

編輯 `.env`，把輸出填入 `DRIFTNET_TOKEN`：

```dotenv
DRIFTNET_TOKEN=請貼上剛才產生的長密碼
DRIFTNET_LANGUAGE=Traditional Chinese (Taiwan)
DRIFTNET_LOCALE=zh-TW
```

`DRIFTNET_TOKEN` 是必要的安全設定。程式在 `DRIFTNET_ACCESS=private` 且 Token 空白時會拒絕啟動，避免無密碼服務被 Tunnel 公開。AI 模型變數都是選用；不需要自動摘要時可保持空白。

`.env`、`data/`、`*.db` 與 SQLite journal/WAL 檔已排除於 Git；`.dockerignore` 也會阻止它們進入 image build context。

## 4. 設定 Cloudflare Tunnel

1. 登入 Cloudflare Zero Trust。
2. 到 **Networks / Networking → Tunnels**，建立 Cloudflared（remotely-managed）Tunnel。
3. 在 Tunnel 的安裝指令中找到 `eyJ...` 開頭的 Tunnel Token，只把它填入本機 `.env`：

   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   DRIFTNET_PUBLIC_URL=https://driftnet.example.com
   ```

4. 在該 Tunnel 新增 **Public Hostname / Published application route**：
   - Hostname：選擇要公開的 HTTPS 網域，例如 `driftnet.example.com`
   - Type：`HTTP`
   - Service URL：`http://driftnet:8787`

`driftnet` 是 Docker Compose service name。不要填 `localhost:8787`：在 `cloudflared` 容器內，`localhost` 代表 cloudflared 自己。兩個服務已加入同一個 `driftnet-network`，所以 cloudflared 能以 service name 解析 driftnet。

Cloudflare 對外提供 HTTPS，容器間則在私有 Docker network 使用 HTTP。不要在 Cloudflare、GitHub 或文件中貼出 Token。

`DRIFTNET_PUBLIC_URL` 請填完整的正式 HTTPS 網址；driftnet 會用它產生卡片與聊天室回覆中的外部連結。尚未建立 Public Hostname 時可先保持空白。

尚未取得 Tunnel Token 時，可以先完成 driftnet 本機測試；cloudflared 會因沒有 Token 而無法建立連線，但不影響資料與 image 設定。取得 Token 後填入 `.env` 並再次執行 `docker compose up -d`。

## 5. 啟動與確認

```bash
docker compose up -d
docker compose ps
docker compose logs -f driftnet
docker compose logs -f cloudflared
```

Mac 本機開啟：

```text
http://localhost:8787
```

輸入 `.env` 中的 `DRIFTNET_TOKEN`。因為 port mapping 是 `127.0.0.1:8787:8787`，區域網路與公網不能直接連到這個 port。

Tunnel 正常時，`cloudflared` log 會顯示已註冊連線。再以瀏覽器開啟 Public Hostname 的 `https://...` 網址，確認出現 driftnet 登入畫面並能用同一組 `DRIFTNET_TOKEN` 進入。若回傳 `502`，優先檢查 Public Hostname 的 Service URL 是否正確填成 `http://driftnet:8787`。

## 6. 查看 log 與停止服務

查看最近 200 行：

```bash
docker compose logs --tail=200 driftnet cloudflared
```

停止並移除容器與 network（不會刪除 bind mount 資料）：

```bash
docker compose down
```

## 7. 更新

```bash
git pull
docker compose up -d --build
```

這會從更新後的 repository 原始碼重建 image。資料使用 `./data:/data` bind mount，不會因重建或移除容器而刪除 `data/driftnet.db`。不要執行 `rm -rf data`。

若要同時更新 cloudflared image：

```bash
docker compose pull cloudflared
docker compose up -d --build
```

## 8. 資料位置與備份

實際 SQLite 資料庫在 repository 內：

```text
data/driftnet.db
```

相關設定、媒體快取或 SQLite 的 WAL/SHM 檔也可能位於 `data/`。最安全的簡單備份方式是先短暫停止服務，再複製整個資料夾：

```bash
docker compose down
mkdir -p backups
cp -a data "backups/data-$(date +%Y%m%d-%H%M%S)"
docker compose up -d
```

`backups/` 不應提交到 GitHub；若需要長期保存，請把備份移到加密磁碟、Time Machine 或另一個受保護的位置。還原前先停止服務，並先保留現有 `data/` 的副本。

## Compose 架構

```text
GitHub repository source
        │ docker compose build
        ▼
driftnet container ── ./data:/data ── data/driftnet.db
        │
        ├── 127.0.0.1:8787（僅 Mac 本機）
        │
        └── driftnet-network ── cloudflared ── Cloudflare HTTPS Public Hostname
```

兩個 service 都使用 `restart: unless-stopped`，Docker Desktop 重新啟動後會自動恢復；若你曾手動停止容器，需再執行 `docker compose up -d`。
