// index.js

/**
 * --- 静态资源 ---
 */
const STYLE_CSS = `
/* --- 复古终端风格样式 --- */
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');
* { box-sizing: border-box; }
body {
    background-color: #0d0d0d; color: #33ff33; font-family: 'VT323', monospace;
    font-size: 18px; line-height: 1.6; margin: 0; padding: 20px;
    text-shadow: 0 0 5px rgba(51, 255, 51, 0.4);
}
.container {
    max-width: 800px; margin: 0 auto; border: 2px solid #33ff33;
    padding: 15px 25px; box-shadow: 0 0 15px rgba(51, 255, 51, 0.3) inset;
}
header h1 { font-size: 2.5em; margin: 0; text-align: center; color: #aaffaa; }
#cursor { animation: blink 1s step-end infinite; display: inline-block; }
@keyframes blink { from, to { opacity: 1; } 50% { opacity: 0; } }
.subtitle { margin: 5px 0 20px 0; text-align: center; color: #88ff88; }
main { margin-top: 20px; }
fieldset { border: 1px dashed #33ff33; padding: 20px; margin-bottom: 30px; }
legend { color: #aaffaa; font-size: 1.5em; padding: 0 10px; text-transform: uppercase; }
h3 { color: #88ff88; margin-top: 0; }
ul { list-style-type: '>>> '; padding-left: 20px; }
li { margin-bottom: 20px; }
code {
    display: block; background-color: #1a1a1a; border: 1px solid #225522;
    padding: 10px; margin: 5px 0; color: #ffffff; word-wrap: break-word; text-shadow: none;
}
.count { color: #888; font-size: 0.9em; margin-left: 10px; }
.try-button {
    display: inline-block; color: #aaffaa; text-decoration: none; border: 1px solid #33ff33;
    padding: 3px 8px; margin-left: 10px; transition: all 0.2s;
}
.try-button:hover, .try-button:focus { background-color: #33ff33; color: #0d0d0d; text-shadow: none; }
.image-preview-container {
    padding: 15px; border: 1px solid #225522; background-color: #1a1a1a; margin: 20px 0;
}
.image-preview {
    border: 1px solid #33ff33; box-shadow: 0 0 10px rgba(51, 255, 51, 0.3);
    padding: 5px; background: #000;
}
.image-preview img { display: block; max-width: 100%; height: auto; }
small { color: #888; }
footer {
    text-align: center; margin-top: 30px; border-top: 1px dashed #33ff33;
    padding-top: 15px; font-size: 0.9em; color: #88ff88;
}`;

// --- 新增配置 ---
// 由于文件被上传到了一个额外的子目录中，我们在这里指定这个前缀。
const BASE_PATH_PREFIX = "koishi/";

// --- 配置区 ---
const AVAILABLE_ORIENTATIONS = ['horizontal', 'vertical', 'square'];

/**
 *  主 Worker 对象，包含路由逻辑
 */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 路由器
        if (path === '/') {
            return handleIndexRequest(request, env);
        }
        if (path.startsWith('/api')) {
            return handleApiRequest(request, env);
        }
        if (path === '/style.css') {
            return handleCssRequest();
        }

        return new Response('Not Found', { status: 404 });
    },
};

/**
 * 处理器：处理 /style.css 请求
 */
function handleCssRequest() {
    return new Response(STYLE_CSS, {
        headers: {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
        }
    });
}

/**
 * 处理器：处理 / (首页) 请求
 */
async function handleIndexRequest(request, env) {
    const bucket = env.IMAGE_BUCKET;
    if (!bucket) return new Response('Server configuration error: R2 bucket not bound.', { status: 500 });

    try {
        const listResult = await bucket.list({ prefix: BASE_PATH_PREFIX, delimiter: '/' });
        if (!listResult.delimitedPrefixes.length) {
            return new Response('Server configuration error: No tag directories found in bucket subdirectory.', { status: 500 });
        }
        const fullTagPrefix = listResult.delimitedPrefixes[0];
        const tagName = fullTagPrefix.substring(BASE_PATH_PREFIX.length).slice(0, -1);
        if (!tagName) return new Response('Could not determine tag name from R2 structure.', { status: 500 });

        const manifestPromises = AVAILABLE_ORIENTATIONS.map(orient =>
            bucket.get(`${BASE_PATH_PREFIX}${tagName}/${orient}/manifest.json`)
        );
        const manifestResults = await Promise.all(manifestPromises);

        const imageCounts = {};
        let totalCount = 0;

        for (let i = 0; i < AVAILABLE_ORIENTATIONS.length; i++) {
            const orient = AVAILABLE_ORIENTATIONS[i];
            const manifest = manifestResults[i];
            let count = 0;
            if (manifest) {
                const imageList = await manifest.json();
                count = Array.isArray(imageList) ? imageList.length : 0;
            }
            imageCounts[orient] = count;
            totalCount += count;
        }

        const url = new URL(request.url);
        const apiBaseUrl = `${url.origin}/api`;

        const html = generateHtml({
            tagName: tagName,
            totalCount: totalCount,
            imageCounts: imageCounts,
            apiBaseUrl: apiBaseUrl,
        });

        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });

    } catch (e) {
        console.error(e);
        return new Response('Error fetching data for index page.', { status: 500 });
    }
}

/**
 * 处理器：处理 /api 请求
 */
async function handleApiRequest(request, env) {
    const bucket = env.IMAGE_BUCKET;
    if (!bucket) return sendJsonError('R2 bucket not bound.', 500);

    try {
        const listResult = await bucket.list({ prefix: BASE_PATH_PREFIX, delimiter: '/' });
        if (!listResult.delimitedPrefixes.length) {
            return sendJsonError('图片库目录未找到或为空。', 500);
        }
        const fullTagPrefix = listResult.delimitedPrefixes[0];
        const tagName = fullTagPrefix.substring(BASE_PATH_PREFIX.length).slice(0, -1);
        if (!tagName) return sendJsonError('Could not determine tag name from R2 structure.', 500);

        const url = new URL(request.url);
        const orientation = url.searchParams.get('orientation') || 'any';

        if (orientation !== 'any' && !AVAILABLE_ORIENTATIONS.includes(orientation)) {
            return sendJsonError(`无效的 orientation 参数。可用值: ${AVAILABLE_ORIENTATIONS.join(', ')}, any`);
        }

        let finalImageName, finalImageOrientation;

        if (orientation === 'any') {
            const masterImageList = [];
            const manifestPromises = AVAILABLE_ORIENTATIONS.map(orient =>
                bucket.get(`${BASE_PATH_PREFIX}${tagName}/${orient}/manifest.json`).then(obj => obj ? obj.json() : [])
            );
            const allLists = await Promise.all(manifestPromises);

            allLists.forEach((imageList, index) => {
                const orient = AVAILABLE_ORIENTATIONS[index];
                if (Array.isArray(imageList)) {
                    imageList.forEach(file => masterImageList.push({ file, orientation: orient }));
                }
            });

            if (masterImageList.length === 0) return sendJsonError('图片库中没有任何可用的图片。', 404);

            const randomEntry = masterImageList[Math.floor(Math.random() * masterImageList.length)];
            finalImageName = randomEntry.file;
            finalImageOrientation = randomEntry.orientation;
        } else {
            const manifestKey = `${BASE_PATH_PREFIX}${tagName}/${orientation}/manifest.json`;
            const manifestObject = await bucket.get(manifestKey);
            if (!manifestObject) return sendJsonError(`指定的分类 '${orientation}' 不存在或缺少 manifest.json 文件。`, 404);

            const imageList = await manifestObject.json();
            if (!Array.isArray(imageList) || imageList.length === 0) return sendJsonError(`指定的分类 '${orientation}' 图片列表为空。`, 404);

            finalImageName = imageList[Math.floor(Math.random() * imageList.length)];
            finalImageOrientation = orientation;
        }

        const imageKey = `${BASE_PATH_PREFIX}${tagName}/${finalImageOrientation}/${finalImageName}`;
        const imageObject = await bucket.get(imageKey);
        if (imageObject === null) return sendJsonError(`选中的图片文件 '${finalImageName}' 不存在。`, 500);

        const headers = new Headers();
        imageObject.writeHttpMetadata(headers);
        headers.set('etag', imageObject.httpEtag);
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        headers.set('Pragma', 'no-cache');
        headers.set('Expires', '0');

        return new Response(imageObject.body, { headers });
    } catch (e) {
        console.error(e);
        return sendJsonError('服务器内部发生未知错误。', 500);
    }
}


/**
 * 辅助函数：发送JSON错误
 */
function sendJsonError(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status: status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

/**
 * 辅助函数：根据动态数据生成HTML
 */
function generateHtml(data) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>~//: 随机图床 API v1.0 ://~</title>
    <link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>小石头随机图床API<span id="cursor">_</span></h1>
            <p class="subtitle">>>> 一个为爱发电的随机图片API, 由Cloudflare Workers强力驱动。</p>
            <p>>>> 当前图库: [ <strong>${data.tagName}</strong> ]</p>
        </header>
        <main>
            <fieldset>
                <legend>API 使用说明</legend>
                <p>本API通过直接输出图片的方式工作，可以直接在 \`<img>\` 标签或CSS的 \`url()\` 中使用。</p>
                
                <h3>// 基本接口 (完全随机)</h3>
                <p>从所有图片中随机返回一张 (总计: ${data.totalCount} 张)。</p>
                <code>${data.apiBaseUrl}</code>
                <a href="${data.apiBaseUrl}" class="try-button" target="_blank">[ 执行 ]</a>

                <h3>// 分类接口 (指定方向)</h3>
                <p>通过添加 \`orientation\` 参数来获取特定方向的图片。</p>
                <ul>
                    <li>
                        <strong>获取横图 (horizontal)</strong>
                        <span class="count">[当前数量: ${data.imageCounts.horizontal}]</span>
                        <code>${data.apiBaseUrl}?orientation=horizontal</code>
                        <a href="${data.apiBaseUrl}?orientation=horizontal" class="try-button" target="_blank">[ 执行 ]</a>
                    </li>
                    <li>
                        <strong>获取竖图 (vertical)</strong>
                        <span class="count">[当前数量: ${data.imageCounts.vertical}]</span>
                        <code>${data.apiBaseUrl}?orientation=vertical</code>
                        <a href="${data.apiBaseUrl}?orientation=vertical" class="try-button" target="_blank">[ 执行 ]</a>
                    </li>
                    <li>
                        <strong>获取方图 (square)</strong>
                        <span class="count">[当前数量: ${data.imageCounts.square}]</span>
                        <code>${data.apiBaseUrl}?orientation=square</code>
                        <a href="${data.apiBaseUrl}?orientation=square" class="try-button" target="_blank">[ 执行 ]</a>
                    </li>
                </ul>
            </fieldset>
            <fieldset>
                <legend>使用示例</legend>
                <p>下面这张图片就是通过调用 \`/api\` 随机获取的：</p>
                <div class="image-preview-container">
                    <div class="image-preview">
                        <img src="/api?t=${Date.now()}" alt="随机图片">
                    </div>
                </div>
                <small>（刷新页面可看到不同的图片...）</small>
            </fieldset>
        </main>
        <footer>
            <p>STATUS: OK. SYSTEM READY.</p>
            <p>由fulie构建。</p>
        </footer>
    </div>
</body>
</html>`;
}