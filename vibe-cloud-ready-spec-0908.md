# 上雲環境約束（Cloud-Ready Spec）— 給 AI coding agent 的參考

最後修訂：2026-09-08（修訂內容見文末「修訂紀錄」；檔名日期 = 最後修訂日）

> **這份文件的用途**：在你開始寫任何 code 之前先讀完。你寫出來的專案最終會被容器化，部署到公司內部的
> **AWS EKS（Kubernetes）** 上。以下是那個環境的硬條件。**只要一開始就照著做，上雲時幾乎不需要改動；
> 沒照做的部分，屆時都是大幅重構。**
>
> **使用方式（給人類）**：把這份檔案放進專案根目錄（例如 `docs/cloud-ready-spec.md`），並在
> `CLAUDE.md` / `.cursorrules` / agent 的系統提示裡加一句：
> 「本專案最終部署在公司內部 EKS，開發任何功能前先讀 `docs/cloud-ready-spec.md`，所有設計必須符合其約束。」

---

## 0. 怎麼用這份文件：**分三關，先把第一關做完**

不要一次讀完 12 條約束然後不知道從哪開始。這份規範分成三關，**順序有意義**：

| 關 | 你要做的事 | 怎麼驗收 | 需要平台團隊嗎 |
|---|---|---|---|
| **第一關** | 本機 `docker compose` 就能把服務叫起來，**所有參數提到 `.env`** | 你自己在筆電上跑 §1.8 的清單 | ❌ **不需要，今天就能做完** |
| **第二關** | 容器與設定符合叢集的硬約束（無狀態、不寫磁碟、log 走 stdout…） | 逐條對 §3 的表 | ❌ 大部分自己驗 |
| **第三關** | 介接平台資源（RDS、S3、排程、網域、config-manager） | 跟平台團隊往返 | ✅ 要 |

**為什麼第一關先做**：

1. **它不卡別人。** 第三關要等 bucket、DB、config-manager 開通，你會卡在那裡。第一關完全在你手上。
2. **它抓掉的正是上雲時最貴的那幾種問題** —— 綁 `127.0.0.1`、寫專案目錄、設定硬寫在程式裡、build 需要
   secret。這些在本機用 `npm run dev` 跑一輩子都不會現形，**一放進容器就爆**。
3. **「本機會動、雲端不會動」的差異絕大多數在這一關就會冒出來**，而在自己筆電上除錯比在叢集裡便宜得多。

> 第一關沒過就別開始談上雲。反過來，第一關過了之後，第二、三關多半只是「換一組 env」。

---

## 1. 第一關：本機 docker compose 跑起來，參數全在 `.env`

### 1.1 先確認你的專案是哪一種形狀

專案分兩種形狀，**要求不一樣**，一開始就要分清楚 —— 認錯形狀會讓你做一堆不需要的東西：

| | **A. web service** | **B. 批次作業（job-only）** |
|---|---|---|
| 例子 | 有畫面、有 API、有人會連進來 | 定時產報表、寄信、同步資料、跑爬蟲 |
| 容器行為 | 常駐，監聽 `PORT` | **跑完就結束** |
| `PORT` / 綁 `0.0.0.0` | 必須 | 不適用 |
| `/health` endpoint | 必須 | **不需要** |
| 本機怎麼叫 | `docker compose up` | `docker compose run --rm <service> <工作名>` |
| 上雲長相 | Deployment + Service + Ingress | **CronJob 直接跑映像**，工作名用 `args` 傳 |

> ⚠️ **§4.7 的「排程＝對外可觸發的 HTTP endpoint」只適用 A 型。**
> 純批次作業**不需要為了讓排程能觸發而硬包一個 HTTP server**：
> 平台也接受 CronJob 直接跑映像、用 `args` 指定工作名稱。
>
> 硬包一個 HTTP server 反而會製造新問題：批次跑 5 分鐘就超過 ALB 的 60 秒 idle timeout，
> 於是你得再做「非同步 + 狀態查詢」，而狀態要存哪裡又回到「要不要 DB」的問題。
>
> **B 型請在開工前跟平台確認走哪一種**，別自己假設。

> 💡 **一個專案可以同時含兩種形狀**——常見於「服務（A）＋批次（B）」：網頁/API 常駐服務
> 與排程批次住同一個 repo、打成不同 image。**逐 workload 判型，不是逐 repo**；
> §8 交給平台的資訊也要按 workload 分開列形狀。
>
> ⚠️ 但 **image 數量以少為佳，能合就合**（2026-09-08 DevOps 釐清）：前後端**沒必要不要拆**成
> 兩個 container——讓同一個 service 容器直接服靜態檔＋API 即可。合理的拆分線是「常駐（A）vs
> 跑完就走（B）」這種**跑法不同**的邊界，不是程式語言或前後端的邊界。

### 1.2 Dockerfile：第一關就要對的幾件

- **以非 root 執行**（`USER` 指令）。假設檔案系統唯讀，**只有 `/tmp` 可寫**。
- **base image 釘住 major**（例：`node:22-slim`），**不用 `latest`**。
- **lockfile 進版控**，安裝一律 `--frozen-lockfile` / `npm ci` / `--locked` 等價旗標。
- **有 build 步驟就用 multi-stage**：build 階段裝完整依賴，runtime 階段只留 production 產物與依賴。
  - **沒有 build 步驟的專案，單 stage 就好**（例：Node 直接跑 TypeScript、Python）——
    分不出階段，硬拆只是多一層沒意義的複製。
  - 重點不是「有幾個 `FROM`」，而是**最終映像裡不要有只有 build 才需要的東西**
    （編譯器、測試框架、型別定義、lint 工具）。單 stage 一樣要把 dev 依賴排掉：
    `npm ci --omit=dev`、`pip install` 不裝 dev group、Go 編完不留 toolchain。
- **`.dockerignore`** 至少排除 `.git`、`node_modules`、`.env*`（但保留 `.env.example`）、測試、文件、build 產物、
  以及任何憑證檔與含個資的產出。
  
  > 🔒 進了 image 就等於外流：image 會被推進 registry，而 layer 是不可變的，事後刪檔案也刪不掉歷史層。
- **build 過程不需要任何 secret**，也不需要連內網。
- **處理 SIGTERM**：收到後停止接受新請求、把手上的事做完再退出（平台給約 30–45 秒排空時間）。
  - 語言 runtime 沒有轉送信號給子行程的話，用 `tini` 之類的 init 當 `ENTRYPOINT`。
  - 🔴 **用了 tini 當 `ENTRYPOINT`，工作名稱就要用 `args` 傳；改用 `command` 會蓋掉 tini**，
    SIGTERM 就沒人收，工作可能被砍在一半（例如剛好砍在「已寄出通知、還沒記錄」中間）。

**DON'T**
- 不要在 `CMD` 裡跑 migration、seed、`chown -R` 或任何「順便初始化」。容器啟動只做一件事。
- 不要在 image 裡放 `.env`。
- 不要假設有 `curl` / `bash` 可用。

### 1.3 `compose.yml`：A 型（web service）

```yaml
name: <app-name>

services:
  app:
    build: .
    env_file:
      - .env                      # ← 值的唯一來源，不進版控
    environment:
      PORT: "3000"
      # 本機用的 base URL；上雲換成 https://<app>.sit.<公司網域>
      APP_BASE_URL: http://localhost:3000
    ports:
      - "3000:3000"
    restart: "no"

  # 有 DB 的話，本機起一個 Postgres，別用 SQLite —— 上雲一定是 Postgres，
  # 本機用不同的 DB 等於把「SQL 方言差異」留到上雲那天才爆。
  db:
    # 🟢 完整 registry 路徑：docker 照吃，而 podman 沒有預設 registry，
    #    短名稱 postgres:16-alpine 會跳互動選單或直接失敗。見 §1.9。
    image: docker.io/library/postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devonly
      POSTGRES_DB: app
    ports:
      - "5432:5432"
```

驗收：`docker compose up` → `curl localhost:3000/health` 回 `200`。

### 1.4 `compose.yml`：B 型（批次作業）

```yaml
name: <app-name>

services:
  job:
    build: .
    env_file:
      - .env
    environment:
      # 產出導到掛出來的目錄，本機看得到。
      # 🔴 不要把 host 目錄掛到 /tmp —— 同一次執行內的暫存與交棒檔多半在那裡。
      OUT_DIR: /out
    volumes:
      # 🔒 產出若含個資，這個目錄要 gitignore
      # 🟢 rootless podman 需要額外的 :U，放 compose.override.yml，見 §1.9
      - ./out:/out
    restart: "no"                 # 🔴 失敗不要自動重跑，見下方
    mem_limit: 2g                 # 對齊叢集的 limits，免得本機過了雲端 OOM
```

用法：

```sh
docker compose run --rm job              # 不帶參數 → 印出所有可跑的工作名稱
docker compose run --rm job <工作名>      # 跑一支
```

- **不帶參數要印出可跑的工作清單**，不要報錯。這是 B 型的「說明書」。
- 🔴 **`restart: "no"`**：會寄信／會寫外部系統的工作，自動重跑等於重複通知真人。
  （叢集上的對應設定是 `backoffLimit: 0`。）
- 🔴 **一個批次＝一個容器。** 如果幾支工作之間靠檔案交棒（前一支寫 `/tmp`、後一支讀），
  就**不能**拆成多個 service 分別跑 —— 拆了就讀不到，而且症狀是「跑完了、看起來成功、其實少做一步」。

### 1.5 把散落的參數提出到 `.env`

這是第一關的重點工作。步驟：

1. **全庫搜尋硬寫的值**：`localhost`、`127.0.0.1`、`http://`、`https://`、port 號、絕對路徑、
   試算表／bucket／專案 ID、email 位址、任何看起來像金鑰的字串。
2. **每一個決定它屬於哪一類**（三類的定義見 §4.2）：build-time 公開值 / runtime secret / runtime 非機密。
3. **加進 `.env.example`**，值留空，並在上一行註明分類與用途。
4. **程式改成讀 env**。
   > 🔴 **不要 fallback 回原本那個硬寫的值** —— 那等於沒改：忘記設的時候它會安靜地連回開發環境，
   > 而「連錯環境但看起來正常」比啟動失敗難查十倍。缺必要值就**大聲失敗並列出缺哪幾個**。

### 1.6 `.env` 的擺法

- **`.env.example` 進版控**，**一個真值都不要有**，涵蓋程式讀到的每一個 env。
  這是**交給平台團隊設定 config-manager 的唯一依據**，也是本機 `.env` 的範本。
- **`.env` 不進版控**（`.gitignore` 加 `.env*` 並 `!.env.example`）。開發者 `cp .env.example .env` 再填。
- **compose 用 `env_file` 讀它**，所以程式裡**不需要任何 dotenv 套件**。
  不用 docker 直接跑時，多數 runtime 也有原生支援（例：`node --env-file=.env`）。
- **整個專案只有一個 env 檔。** 不要 `.env` + `.env.secrets` + `.env.dev` 三份 —— 一定會分岔，
  而分岔的那半就是會出事的那半。

**🔴 有一類值刻意不要放 `.env`：會讓真人收到東西的開關。**

寄信、發通知、寫入外部系統這種「一送出去就收不回來」的開關（`SEND_MAIL=1`、`NOTIFY_LIVE=1`…），
請寫在 `compose.yml` 的 `environment:` 裡並預設關閉：

```yaml
    environment:
      NOTIFY_DRY_RUN: "1"     # 一票否決：所有對外送出點都不送
      SEND_MAIL: ""           # 空＝不寄
```

兩個理由：

1. **「這個服務會不會對外發東西」要看得見。** 藏在一包幾十個變數的 `.env` 裡，沒有人會去確認。
2. **`.env` 是每個人自己機器上的檔，裡面可能有正式環境的憑證。** 沒有這幾行的話，
   一個本來只想看看畫面的 `docker compose up` 就真的發出去了。

要臨時打開就在指令上覆寫（`environment` 的優先序高於 `env_file`，CLI 的 `-e` 又高於 `environment`）：

```sh
docker compose run --rm -e NOTIFY_DRY_RUN= -e NOTIFY_LIVE=1 job <工作名>
```

### 1.7 建議加一支測試守住 `.env.example`

`.env.example` 過期的後果不是「文件不完整」，而是**雲端少注入一個設定** ——
而缺設定的表現往往是「跑完了、看起來成功、其實做錯事」。三條：

1. **程式讀了、`.env.example` 沒列 → 紅。** 掃 `lib/`、`src/`、`scripts/` 裡所有 env 讀取。
   ⚠️ 別只認 `process.env.X`：包一層 helper 的寫法（`need("X")`、`cfg("X")`）也要認，
   不然漏列的正好是那些。
2. **`.env.example` 列了、沒有任何程式讀 → 紅。** 這條最容易被忽略，但那份清單是交給平台團隊的
   唯一依據 —— **每多一個沒人讀的 key，對方就多一個「這到底要不要設、值從哪來」要問**，
   而問不出來時最可能的處理是隨便填一個，然後你得到一個安靜錯掉的設定。
   （環境自己提供的變數如 `CI`、`RUNNER_TEMP` 放進具名 allowlist 並註明理由。）
3. **每個 key 都標了分類** build-time / runtime-secret / runtime-plain。

### 1.8 ✅ 第一關驗收清單

```
□ .env.example 涵蓋程式讀到的每一個 env，值全空，且每個都標了分類
□ cp .env.example .env（值全空）→ docker compose build 成功
□ build 過程沒有用到任何 secret、沒有連內網
□ A 型：docker compose up 起得來，curl localhost:$PORT/health 回 200
□ B 型：docker compose run --rm job（不帶參數）印出可跑的工作清單
□ 缺必要 env 時大聲失敗並列出缺哪幾個，不是 fallback 到預設值默默跑
□ 容器以非 root 執行
□ 程式沒有寫入 /tmp 以外的路徑（產出要看得到就掛 volume）
□ 全庫搜尋：沒有 hardcoded 的 localhost / 對外網址 / 金鑰 / 密碼 / 絕對路徑
□ docker compose down 之後再 up，行為一致（沒有靠容器內殘留的狀態）
□ 對外會發東西的開關預設關閉，而且寫在 compose.yml 看得見的地方
```

> ⚠️ **Apple Silicon 注意**：在 M 系列 Mac 上 build 出來的是 **arm64** 映像。
> 本機用沒問題，但**那不是會上叢集的那顆**（CI 在 amd64 上 build）。不要拿本機這顆去推 registry。

### 1.9 本機容器引擎：Docker Desktop 的替代方案

不能裝 Docker Desktop 也能做第一關 —— `docker` CLI 與 compose plugin 可以單獨安裝，
接到別的容器引擎上，指令與 `compose.yml` 都不用改。

#### 步驟 0：先確認你是不是已經有能用的環境

```sh
docker compose version                          # 有版本號就是 CLI 已具備
docker info --format '{{.OperatingSystem}}'     # 看目前接的是哪個引擎
```

| 第二行的輸出 | 你的狀況 |
|---|---|
| `Docker Desktop` | 需要換掉，往下挑一個方案 |
| `Alpine Linux v3.xx`（colima）/ `OrbStack` / `podman` 等 | **已經可以了**，直接跳到 §1.8 驗收 |
| 指令不存在 | 沒裝過，往下挑一個方案 |

#### 方案 A：colima（建議）

對使用者最無感 —— 裝完一樣打 `docker compose up`。

```sh
# 1. 引擎 + docker CLI 與兩個 plugin
brew install colima docker docker-compose docker-buildx

# 2. 讓 docker CLI 找得到 plugin —— Homebrew 不會自動掛上，
#    少了這步 `docker compose` 會說找不到指令。
#    Apple Silicon 用 /opt/homebrew，Intel Mac 改成 /usr/local
mkdir -p ~/.docker && cat > ~/.docker/config.json <<'EOF'
{
  "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]
}
EOF

# 3. 開 VM（跑 app + Postgres 大概 4 core / 8G 夠用）
colima start --cpu 4 --memory 8 --disk 60
```

> ⚠️ 已經有 `~/.docker/config.json` 的人不要用上面的 `cat >` 蓋掉它（裡面可能有 registry 登入資訊），
> 手動把 `cliPluginsExtraDirs` 這個 key 加進去就好。

日常操作只有 `colima start` / `colima stop` / `colima status`。
**開機後要自己 `colima start`** —— Docker Desktop 會自動起，colima 預設不會。

#### 方案 B：podman

```sh
brew install podman docker docker-compose docker-buildx
podman machine init --cpus 4 --memory 8192 --disk-size 60
podman machine start

# 把 docker CLI 指向 podman 的 docker-compatible socket（建議寫進 ~/.zshrc）
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

plugin 設定同方案 A 的步驟 2。之後照常 `docker compose up`。

> 🔴 **用 podman 請仍然用真正的 `docker compose` CLI（如上），不要改用 `podman-compose`。**
> 後者是獨立的重寫實作，在 `run --rm`、`env_file` 與 `environment` 的優先序（§1.6）、
> `depends_on` 條件這些地方跟 compose 規格有行為差異 —— 而第一關的驗收正好大量依賴這些語意。
>
> podman 另有 rootless UID 映射要處理，見下方 `compose.override.yml`。

#### 方案 C：OrbStack

```sh
brew install --cask orbstack
```

裝完即可用，不需要額外設定 plugin。⚠️ 商用需要付費授權，用之前先確認。

#### 裝完怎麼驗收

直接跑 §1.8 的清單。**第一關的每一條都跟引擎無關** —— 換了引擎不會讓任何一條變寬鬆或變嚴格。

**要進版控的 `compose.yml` 保持引擎中立，兩個原則：**

1. **image 一律寫完整路徑**（`docker.io/library/postgres:16-alpine`）。docker 照吃；
   podman 沒有預設 registry，短名稱會卡住。零成本的保險。
2. **引擎專屬的設定放 `compose.override.yml`，並 gitignore 它。**
   compose 會自動疊上這個檔案，指令不用改。

最常見的引擎專屬設定是 **rootless podman 的 UID 映射**：容器裡的非 root user（§1.2 要求的）
寫進 bind mount（§1.4 的 `./out`）時，UID 會經 subuid 映射，結果是容器沒權限寫、
或 host 端檔案 owner 變成一個高位 UID。docker 走 root daemon 沒這個問題。

```yaml
# compose.override.yml —— 不進版控（.gitignore 加一行 compose.override.yml）
services:
  job:
    volumes:
      - ./out:/out:U          # podman：把掛入目錄 chown 成映射後的 UID
    # 或改用 userns_mode: keep-id，讓容器 UID 直接對應 host user
```

> ⚠️ 實測 Docker Compose v5 對 `:U` 與 `userns_mode: keep-id` 是**安靜忽略**、不會報錯，
> 所以直接寫進 `compose.yml` 目前兩邊都跑得動。但那依賴的是 compose 的寬鬆解析（跨版本不保證），
> 而且 **`compose.yml` 是交給 CI 與平台團隊看的那份契約** —— 引擎專屬的東西不該混在裡面。

⚠️ **換引擎不會改變上方的 arm64 問題**：colima / podman / OrbStack build 出來的一樣是 arm64，
CI 仍然在 amd64 上重建。

---

## 2. 目標環境是什麼（一段話）

容器（Docker image）→ 推進公司內部 registry → 由 GitOps + ArgoCD 部署到 **EKS 的一個共用 namespace**。
對外走 ALB Ingress，網域是 `<app>.sit.<公司網域>`，**僅公司內網 / VPN 可達**。資料庫是 **AWS RDS
PostgreSQL**，檔案放 **S3**，排程用 **Kubernetes CronJob**，環境變數／secret 由平台的 config-manager
注入成 k8s Secret。

**它不是** Vercel / Netlify / Firebase / Supabase 這類 PaaS。所以：**任何依賴「某個 PaaS 才有的能力」
的設計，最後都要拆掉重寫。** 這是整份文件最重要的一句話。

---

## 3. 硬約束速查（12 條，標了屬於哪一關）

| # | 約束 | 關 | 沒做的後果 |
|---|---|---|---|
| 1 | A 型：一個容器、一個 process、監聽 `PORT` 且綁 `0.0.0.0`（B 型不適用） | 1 | 起不來 / 健康檢查失敗 |
| 2 | 所有設定來自環境變數；secret **只在 runtime** 注入 | 1 | secret 進 image、換值要重 build |
| 3 | 完全無狀態：pod 隨時被殺、可能多份 | 2 | 登入掉、資料不一致、上傳檔消失 |
| 4 | 不寫本機磁碟（除 `/tmp`）；檔案一律進物件儲存 | 1（不寫磁碟）／3（S3） | 重啟即失、多 pod 看不到彼此的檔 |
| 5 | 不用 SQLite / 檔案型 DB / 檔案型佇列 | 1 | 無法水平擴充、資料遺失 |
| 6 | DB = 外部 PostgreSQL，連線資訊來自 env；TLS 依平台指示（內網非硬性） | 3 | 連不上 |
| 7 | schema 變更 = repo 內 forward-only SQL migration；**runtime 不做 DDL** | 2 | 上不了、權限被拒 |
| 8 | 排程 = HTTP endpoint（A 型）或 CronJob 直接跑映像（B 型）；**都不是** in-process timer | 2 | 排程不會跑／重複跑 |
| 9 | 雲端資源（S3 等）用 SDK **預設憑證鏈**，程式內零 key | 3 | 需要發 access key，安全審不過 |
| 10 | log 只寫 stdout/stderr | 1 | 看不到 log |
| 11 | A 型：一個**無外部依賴**的 health endpoint | 1 | DB 一抖，pod 就無限重啟 |
| 12 | 平台專屬能力（auth / storage / mail / AI / cron）一律包在 adapter 後面用 env 切換 | 2 | 搬遷 = 重寫 |

---

## 4. 逐項要求

### 4.1 容器與啟動（A 型的補充）

- 讀 `process.env.PORT`（或同語言等效），預設 `3000`（Node）或 `8080`（靜態站／其他）；
  **綁 `0.0.0.0`，不是 `127.0.0.1`**。
  - 容器裡的 `127.0.0.1` 只指容器自己，綁它等於「外面一律連不進來」：k8s 的 probe 打的是 pod IP
    → pod 永遠不 Ready。
  - 本機開發時瀏覽器走 loopback 所以完全正常，**這個錯只會在容器化之後才爆**，
    而且症狀是「pod 起不來」，不像網路綁定問題。
  - 常見預設就是錯的（要明確指定）：Flask `app.run(host="0.0.0.0")`、Django `runserver 0.0.0.0:8000`、
    uvicorn/gunicorn `--host 0.0.0.0`、Vite `--host 0.0.0.0`、Next.js `HOSTNAME=0.0.0.0`、
    PHP `php -S 0.0.0.0:8080`。Node `http`/Express 與 Go `":8080"` 省略 host 時本來就是所有介面，
    **只要別手寫 `localhost` / `127.0.0.1`**。
  - 這不等於對外暴露：pod IP 在叢集內部網段，對外由 Service + Ingress 決定。
  - 🟢 **第一關就驗得到**：`docker compose up` 之後從容器外面 `curl` 打得到才算過。

其餘容器要求見 §1.2。

### 4.2 設定與 secret（最容易踩的一段）

把每個設定值分成三類，並在 `.env.example` 裡**逐個註明屬於哪一類、用途是什麼**：

| 類別 | 例子 | 注入時機 | 改值成本 |
|---|---|---|---|
| **build-time 公開值** | 前端 bundle 需要的 API base URL、feature flag（如 `NEXT_PUBLIC_*` / `VITE_*`） | build 時 `--build-arg` | **要重新 build image** |
| **runtime secret** | DB 帳密、API key、`AUTH_SECRET`、`CRON_SECRET` | k8s Secret → 容器 env | 改 secret + 重啟即可 |
| **runtime 非機密** | log level、feature flag、bucket 名、region | 同上 | 同上 |

**DO**
- 所有設定都走環境變數。不要 `config.production.json` 這種「一個環境一份檔」。
- **對外 base URL 一律來自 env**（`APP_BASE_URL` 之類），OAuth callback、寄信連結、絕對路徑都用它組。
- **盡量減少 build-time 公開值**。能挪到 runtime 就挪（例：後端讀 env 再回傳給前端 / 用 runtime config
  endpoint），因為 build-time 值改一次就要重跑一次 pipeline。
- 缺少必要 env 時**啟動就大聲失敗**（fail fast，訊息列出缺哪幾個）。
- `.env.example` 進版控且維持最新，最好有測試守著（§1.7）。

**DON'T**
- 不要把 secret 當 build-arg 傳（會留在 image layer；前端框架還可能把它編進 bundle）。
- 不要 commit `.env` / `.env.local`。
- 不要用 `if (NODE_ENV === 'production')` 去猜 host、DB、bucket。環境差異一律用 env 表達。
- **不要空字串當「沒設」處理錯**：config-manager 注入空值很常見，而 `env.X ?? "預設值"` 這種寫法
  **攔不住空字串**（`??` 只對 null/undefined 生效）→ 你會得到一個空的 bucket 名、空的 image tag。
  請用「trim 過之後是空的就當沒設」。

### 4.3 無狀態（多副本 + 隨時被殺）

**DO**
- session / 登入狀態放 **簽章 cookie（JWT）或 DB**，不要放 process 記憶體。
- 需要跨請求共享的東西（rate limit 計數、鎖、佇列、快取）放 **DB 或外部 cache**。
  行程內記憶體快取只能是「有就更快、沒有也正確」的最佳努力。
- 長時間工作（>30 秒）不要塞在 HTTP 請求裡完成：寫一筆 job 狀態進 DB，讓排程 endpoint 分批處理，
  前端輪詢進度。**假設 ALB 有約 60 秒的 idle timeout。**
- 回應送出後的「背景繼續做」不可靠（pod 可能立刻被回收）→ 一樣改成 job。

**DON'T**
- 不要用 `setInterval` / 背景 thread 當排程（多副本會重複跑，縮容時直接消失）。
- 不要用行程內 in-memory 佇列、in-memory 鎖、in-memory 上傳暫存。

### 4.4 檔案與物件儲存

**DO**
- 使用者上傳、產生的報表 / 圖片 / 匯出檔 → 一律進 **S3**。程式只需要 **bucket 名 + region 兩個 env**。
- 憑證走 **AWS SDK 預設憑證鏈**（平台會把 IAM role 綁到 pod 的 ServiceAccount）。程式**不要**讀
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`，也不要提供「填 key」的設定。
- 需要讓瀏覽器直接下載／上傳時用 **presigned URL**。
- 暫存檔只寫 `/tmp`，用完刪掉，且不能假設下一個請求還看得到它。
- **沒設 bucket 就整段不做**（連 SDK 都不載入）。這樣本機開發不需要任何 AWS 憑證，
  而且「這台機器有沒有在寫 S3」一目了然。

**DON'T**
- 不要用平台專屬的 storage SDK 當唯一實作 —— 本機開發階段要用請包在 §4.8 的 adapter 後面。

### 4.5 資料庫

**DO**
- 目標是 **AWS RDS PostgreSQL**。連線參數用**分開的 env**：`DB_HOST` / `DB_PORT` / `DB_USER` /
  `DB_PASSWORD` / `DB_NAME`，另外允許 `DATABASE_URL` 存在時直接短路使用（方便本機）。
  密碼帶原始值，由程式自己 URL-encode。
- **本機就用 Postgres**（compose 起一個，見 §1.3）。用 SQLite 開發等於把方言差異留到上雲那天才爆。
- **TLS：內網環境非硬性要求**（2026-09-08 DevOps 釐清；連線都在公司內網/VPC 內）。要不要開以平台指示為準。
  **若有開 TLS**，做到「加密、不驗 CA」即可，但 **`sslmode` 的值依 driver 而異，抄錯直接連不上**：
  - libpq / psycopg（Python 等）：用 `sslmode=require`（這一系的 `require` 本來就不驗 CA；
    **`no-verify` 不是有效值**，有效值僅 disable/allow/prefer/require/verify-ca/verify-full）。
  - Node `pg`：用 `sslmode=no-verify`（這一系的 `require` 會驗憑證而失敗）。
  - （2026-09-08 修訂：原文寫「TLS 必開」且一律 `no-verify`——前者內網非硬性，後者在 libpq/psycopg 上無效。）
- **連線池要小**（單 pod 個位數）。`pod 數 × pool 上限` 必須遠低於 RDS 的 max_connections。
- app 的 DB 帳號**只有 CRUD 權限**。任何 `CREATE` / `ALTER` / `DROP` 都不能在 runtime 執行。
- 只用標準 PostgreSQL 功能。需要的 extension 要**列出來事先確認**（不能假設 `pgvector`、`postgis` 已裝）。
- 授權邏輯寫在**應用層**。不要把「誰能看什麼」建在依賴某個 BaaS 身分函式的 DB 規則上。
- **商業邏輯不放 DB function**（stored procedure / BaaS RPC / Edge Function）：這類邏輯通常不在
  repo 版控，code review 看不到、搬遷時要額外從 DB「出土」。DB 只放資料與必要約束；
  邏輯寫在應用層，跟著 repo 走。

**Schema 變更（migration）**
- 目錄：`db/migrations/NNNN_<描述>.sql`，四位數零補、**檔名即版本、字典序執行**。
- 一律 **forward-only、additive**：沒有 down migration；不要改欄位型別改到不能相容；
  先加新欄位、雙寫、再清舊的。
- **已經套用過的檔案永不改名、永不修改內容**。
- 每支檔案跑在**單一 transaction** 內 → **不能用 `CREATE INDEX CONCURRENTLY`、`VACUUM`、`REINDEX`**。
  - 原因是 PostgreSQL 自己禁止：`CONCURRENTLY` 需要在過程中多次自行 commit，包在 `BEGIN` 裡會直接報
    `cannot run inside a transaction block`（SQLSTATE 25001）。同家族還有 `DROP INDEX CONCURRENTLY`、
    `REINDEX CONCURRENTLY`、`CREATE DATABASE`、`ALTER SYSTEM`。
  - 普通 `CREATE INDEX` 會在該表持 `SHARE` 鎖（讀可以、**寫被擋**）直到建完。內部系統的資料量通常是
    秒級，**直接用普通 `CREATE INDEX`**；`CONCURRENTLY` 是為了幾千萬列的大表才存在。
  - 另一個別自動化它的理由：`CONCURRENTLY` 失敗會留下 **INVALID 索引**（不被查詢使用卻持續拖慢寫入），
    要人工 `DROP` 清掉 —— 天生無法原子回滾，不適合放在無人盯著的 CI 步驟。
  - 真的需要時：拆成獨立檔並讓 runner 支援跳過 transaction（如 `-- migrate:no-transaction` 檔頭），
    或由高權限帳號在維護時段手動執行後，**在 `schema_migrations` 補一筆對應檔名**讓 runner 略過。
- 提供一支 `db:migrate` 指令（零／少依賴的 runner）：從 env 讀連線、取 advisory lock、
  `CREATE TABLE IF NOT EXISTS schema_migrations`、只跑沒記錄過的檔案、成功後記錄 → **重複執行安全**。
  CI 會呼叫它。
- 若 DB 已有既有 schema，第一支檔案當 baseline，並提供一次性「標記為已套用」的 SQL。

### 4.6 認證與網路邊界

**DO**
- OAuth（Google 等）走**瀏覽器 redirect** 沒問題；callback URL 由 env 組出。
- 在反向代理後面 → **信任 `X-Forwarded-*`**（框架要開對應開關），否則會產生 http 的 redirect URL
  或判錯 host。
- cookie 用 `Secure` + `HttpOnly` + 適當 `SameSite`。
- 需要被外部系統呼叫的介面，用**共享 token 驗證**（header 帶 bearer / service token），並做常數時間比對。

**DON'T**
- **不要設計「依賴外部服務主動打進來」的流程**（第三方 webhook、payment callback、SaaS push 通知）。
  這個環境**只有內網可達**，外部打不進來。需要同步外部狀態就改成**由我方定時去拉**。
- 不要假設固定的對外 IP（要 allowlist 就得另外申請）。
- 不要假設任意外部網域都連得出去 —— 把 app 會呼叫的**外部 host 清單寫在 README**，交由平台確認 egress。
  - 🟢 **建議寫一支「連通性自檢」腳本**：只發 GET、不需憑證、印出每個外部 host 的狀態碼。
    本機跑一次留底，之後請平台在叢集裡跑同一支，兩邊一比就知道是不是被 egress 擋掉。

### 4.7 排程 / 定期任務

**A 型（web service）**：平台的做法是 k8s CronJob 依時間去打你的 HTTP endpoint（cluster 內部呼叫，
帶共享 secret）。

- 每個定期任務做成一支 endpoint：`/api/jobs/<name>`，驗 `Authorization: Bearer $CRON_SECRET`。
- **有界執行時間**：單次處理一批（10–50 筆）就回，回傳處理了幾筆；剩下的等下一次。單次控制在 **5 分鐘內**。

**B 型（批次作業）**：CronJob 直接跑映像，工作名用 `args` 傳，不需要 HTTP endpoint。

- 容器的 `ENTRYPOINT` 就是你的工作分派器（讀第一個參數決定跑哪一支）。
- 🔴 **CronJob 要用 `args:` 不要用 `command:`** —— `command` 會蓋掉 `ENTRYPOINT` 的 init（tini），
  SIGTERM 就沒人收。
- 幾支工作必須在同一次執行裡跑完的（靠檔案交棒），要當成**一個** CronJob，不要拆。

**兩型共通**

- **idempotent**：同一時間被打兩次、或連續被打多次，結果都要正確。
  最實用的做法是留一份「今天這件事做過了沒」的台帳（DB 一張表），做過就不再做。
- **失敗要有人知道。** 無人環境跑失敗如果只寫進 log，等於沒發生 → 非零結束並發通知。
- 回傳／印出 JSON 摘要（處理數、失敗數）。
- 把「需要哪些排程、多久一次、可接受的時段」寫在 README。
  **假設夜間與假日可能縮容 → 排程一律（盡量）排在上班時段內。**
  - 例外：**依收件人時區發送**的通知類排程（使用者跨多時區）無法一刀切成單一上班時段——
    這類需求要**開工前跟平台確認**夜間/假日縮容下的 CronJob 調度支援，不要自己假設夜間一定會跑。
    另外「給主管看的單一播報」和「逐人通知」要分開判斷：前者通常可以移進上班時段，後者不行。
- 時間：pod 預設 **UTC**。DB 存 UTC，任何跟「幾點」有關的商業邏輯都要**顯式帶時區**，
  不要依賴系統 local time —— 平台把 `TZ` 蓋掉你也不能算錯。

**DON'T**
- 不要用 PaaS 專屬的排程宣告檔（那類檔案在 EKS 上不會被讀）。
- 不要寫「只能剛好執行一次」的排程邏輯（要容忍重複與偶發延遲）。
- 不要讓失敗自動重試很多次。會寄信、會寫外部系統的工作，重試等於重複通知真人。

### 4.8 平台鎖定：一律包一層 adapter

這是「上雲要不要大改」的分水嶺。凡是以下能力，**先定義一個介面，再放兩個實作，用 env 切換**：

| 能力 | 本機／舊平台可能用 | 上雲後 | 切換 env（範例） |
|---|---|---|---|
| 認證 | BaaS 內建 auth | 自管 OAuth（Auth.js 等）+ JWT | `AUTH_PROVIDER=baas\|oauth` |
| 檔案儲存 | BaaS Storage | S3（預設憑證鏈） | `STORAGE_PROVIDER=baas\|s3` |
| 資料存取 | BaaS client SDK | 直連 Postgres（SQL / 輕量 ORM） | `DATABASE_URL` / `DB_*` |
| 排程 | PaaS cron | HTTP job endpoint 或 CronJob 跑映像 | 無 |
| 寄信 / 通知 | 任一 SaaS | 同一介面換 provider | `MAIL_PROVIDER=...` |

**DO**：業務程式只依賴自己定義的介面（`storage.put()`、`auth.currentUser()`），
不要在 20 個檔案裡直接 import 廠商 SDK。
**DON'T**：不要讓廠商的資料模型／權限模型滲進商業邏輯。

### 4.9 Log、錯誤、健康檢查

**DO**
- log 寫 **stdout / stderr**，一個事件一行（建議 JSON）。帶上請求 id / 使用者 id / 耗時。
- **不要**寫 log 檔、不要做 log rotation。
- log 裡不要出現 token、密碼、完整個資。
- error tracking（Sentry 之類）的 DSN 走 env，**沒設就安靜停用**，不要因此啟動失敗。
- **A 型的健康檢查**：`GET /health` 回 `200 {"status":"ok"}`，**不查 DB、不查外部服務、不需登入**。
  - 理由：liveness 和 readiness 用同一支。若它依賴 DB，DB 一抖就變成全體 pod 反覆重啟 ——
    DB 故障應該表現為請求錯誤，不是服務消失。
  - 想暴露依賴狀態就另開一支 `/health/deps`，且**不要**接到 k8s probe 上。
- **B 型不需要 health endpoint**（沒有常駐 process 可檢查）。它的「健康」是「該跑的時候有跑完」——
  用一支唯讀的看門狗工作去讀台帳確認，比開 HTTP port 有用。

### 4.10 命名與 repo 結構

- repo 名用 **kebab-case、全小寫**，且**之後不要改**：它同時會是 image repository 名、
  k8s manifest 目錄名、Deployment / Service 名。四處必須一致。
  - 🔴 **一定要全小寫**：container registry（ECR 等）的 repository 名**不接受大寫**，
    有大寫字母的 repo 名會在第一次 push 就被拒。
  - 單 repo 產**多個 image** 時（例：常駐服務與批次分開打包，見 §1.1 混合形狀；image 數量能合就合），
    image 名用 `<repo>-<component>` 後綴（如 `my-app` / `my-app-batch`），同樣全小寫。
- repo 根目錄要有：`Dockerfile`、`.dockerignore`、`compose.yml`、`.env.example`、
  `db/migrations/`（若有 DB）、README 的「本機怎麼跑」與「部署備註」兩段。

---

## 5. 部署流程長什麼樣（agent 只需知道結論）

```
push 到 main
   → CI 建 image，tag = commit 短 SHA，推進內部 registry
   → （若有 DB）CI 對 DB 套用未執行的 migration
   → CI 自動更新 GitOps repo 裡的 image tag
   → ArgoCD 自動同步到 EKS（auto-sync、self-heal）
```

由此推導出的行為約束：

- **image 不可變**：同一個 commit = 同一個 image。要換行為就 commit，不要想在容器裡改東西。
- **`kubectl edit` 沒用**：GitOps 會把手改的內容同步回去。
- **回滾 = 把 image tag 指回上一個 SHA**，所以**每個 commit 都必須是可部署的**。
- **migration 失敗會擋住部署**（刻意設計）→ migration 必須自己保證安全、可重跑。
- **新增 / 修改 env 需要平台團隊介入**（設進 config-manager），不是你 push 一下就有 →
  新增 env 時要**批次提出、附用途**，並確保「舊 env 缺新值時程式仍能啟動」或明確標記為必填。
- **k8s manifest 由人維護在 GitOps repo，CI 只動 image tag。** 你的 repo 裡不需要放 k8s YAML；
  排程時間、資源上限這些是部署決定，改它們是改另一個 repo。

---

## 6. 反模式速查表（看到就改掉）

| 反模式 | 為什麼不行 | 改成 |
|---|---|---|
| 只能用 `npm run dev` 跑起來 | 上雲第一步就卡住，而且環境差異全被藏著 | `docker compose up` / `run` |
| 參數散在程式碼裡 | 換環境要改 code、重 build | `.env` + `.env.example` |
| 寫檔到專案目錄 / `./uploads` | 非 root、image 唯讀、多 pod 不共享 | S3（暫存只寫 `/tmp`） |
| SQLite / JSON 檔當資料庫 | 無法多副本、重啟即失 | PostgreSQL（本機也用） |
| `setInterval` 跑定期任務 | 多副本重複、縮容消失 | job endpoint 或 CronJob |
| in-memory session / 快取當真相 | 多副本不一致 | cookie JWT / DB |
| 硬寫 `http://localhost:3000` | 換環境就錯 | `APP_BASE_URL` env |
| 綁 `127.0.0.1` | pod 永遠不 Ready | 綁 `0.0.0.0` |
| 把 secret 當 build-arg | 留在 image layer | runtime env |
| runtime 執行 `CREATE TABLE` | app 帳號無權限 | `db/migrations/` + CI |
| health endpoint 去查 DB | DB 抖動 → 全體重啟 | 無依賴的 `/health` |
| 依賴第三方 webhook 打進來 | 環境只有內網可達 | 改為定時拉取 |
| 依賴 PaaS 專屬檔案 | EKS 不讀 | 通用機制 + adapter |
| 直接 import 廠商 SDK 散落各處 | 搬遷＝重寫 | 介面 + env 切換 |
| 請求裡做 3 分鐘的工作 | ALB timeout、pod 被回收 | job + 進度輪詢 |
| 缺 env 時 fallback 到預設 host | 默默連錯環境 | fail fast |
| 對外通知的開關放在 `.env` 裡 | 看不出這服務會不會對外，而 `.env` 可能有正式憑證 | 寫在 `compose.yml` / CronJob 的 env |
| repo 名有大寫 | registry 拒收 | 全小寫 kebab-case |

---

## 7. 自我檢查

**第一關**（自己在筆電上驗，見 §1.8）—— 沒過就不要往下走。

**第二、三關**

```
□ 兩個副本同時跑不會壞（登入、上傳、排程、計數）
□ GET /health 回 200，且在 DB 關掉時仍然回 200（A 型）
□ 把 DB 換成一個全新的空 Postgres，跑一次 migrate 能建出完整 schema；再跑一次不會失敗
□ 程式沒有任何 DDL 語句在 runtime 路徑上
□ 所有定期任務都能手動觸發，且重複觸發安全（A 型：curl 帶 bearer；B 型：直接跑映像帶 args）
□ 檔案上傳走物件儲存介面，程式內沒有 AWS key
□ 廠商 SDK 只出現在 adapter 檔案裡
□ 對外呼叫的 host 清單、需要的排程時段、需要的 env，都寫進 README
□ 空字串的 env 被當成「沒設」處理（config-manager 注入空值很常見）
```

---

## 8. 交給平台團隊時要一起附上的資訊

1. **`.env.example`**：每個變數的用途 + 分類（build-time / runtime secret / runtime 非機密）+ 哪些是必填。
   **並標明哪幾區是這個服務真的需要的** —— 如果檔案裡混著別條線或已退役功能的變數，請講清楚，
   否則對方無從判斷要設哪些。
2. **專案形狀**：A 型（web service）還是 B 型（批次作業）。這決定要不要 Service / Ingress / probe。
3. **服務基本資料**（A 型）：容器 port、health endpoint 路徑、期望的網域名稱。
4. **DB 需求**：是否需要 DB、需要哪些 extension、是否有既有資料要匯入（提供 dump + 驗證用的 row count）。
5. **物件儲存需求**：需要幾個 bucket、大概用量、保存期限、寫入權限方式（IRSA 或 access key）。
6. **排程需求**：每支 job 的名稱／路徑、頻率、可接受時段、單次預期耗時。
7. **對外連線清單**：會呼叫哪些外部 host / port（OAuth、AI API、通知服務…）。
8. **資源預估**：CPU / 記憶體需求、預期併發。
   （會開瀏覽器產 PDF／截圖的工作記憶體要放寬 —— Chromium 單次就可能吃到 1.5GiB。）
9. **個資說明**：產出或 log 裡有沒有個資、存放位置與保存期限、叢集 log 會不會被平台收走。

---

**一句話總結**：先讓它在自己的筆電上用 `docker compose` 跑起來、所有參數都在 `.env` 裡 ——
做到這一步，剩下的上雲工作大多就只是換一組 env。

---

## 修訂紀錄（Release Notes）

### 2026-09-08

**批次一：首個實案（排班系統上雲）review 回饋**

- §4.5 **sslmode 依 driver 區分**（事實修正）：原文一律寫 `sslmode=no-verify`，該值在 libpq/psycopg（Python 系）是無效值會直接連不上；現分列 psycopg 用 `require`、Node `pg` 用 `no-verify`。
- §1.1 新增**混合形狀**說明：一個專案可同時含 A 型服務與 B 型批次，逐 workload 判型、不是逐 repo。
- §4.5 新增「**商業邏輯不放 DB function**」（stored procedure / BaaS RPC / Edge Function 不在版控，review 看不到、搬遷要出土）。
- §4.7 新增排程時段**例外**：依收件人時區發送的逐人通知不可一刀切上班時段；播報與通知分開判斷。
- §4.10 新增**多 image 命名**慣例：`<repo>-<component>` 後綴。

**批次二：DevOps 釐清（2026-09-08 下午）**

- §4.5 與硬約束 #6：**TLS 由「必開」改為「內網非硬性、依平台指示」**；有開時 sslmode 規則同上。
- §4.7：排程「一律」→「一律（**盡量**）」排上班時段。
- §1.1／§4.10：**image 數量能合就合**——前後端沒必要不拆 container；合理拆分線是「常駐（A）vs 跑完就走（B）」，不是前後端邊界。

### 2026-09-04

- 全文重構為「**三關**」結構（§0）：第一關本機 compose、第二關叢集硬約束、第三關平台介接。
- 新增 **A／B 專案形狀**（§1.1）：B 型批次不需 HTTP server 與 `/health`，CronJob 直接跑映像帶 `args`。
- 新增第一關驗收清單（§1.8）、Docker Desktop 替代方案（§1.9，colima／podman／OrbStack）。
- `.env` 規約強化：對外發送開關不放 `.env` 且預設關（§1.6）、`.env.example` 三條守門測試（§1.7）。
- 新增：空字串 env 當「沒設」（§4.2）、repo 名全小寫（§4.10）、k8s manifest 不放 app repo（§5）。

### 初版（2026-09-04 前）

- 12 條硬約束速查、逐項要求、反模式速查表、上雲前自我檢查、交平台資訊清單。
