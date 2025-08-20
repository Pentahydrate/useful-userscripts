// ==UserScript==
// @name         Microsoft Rewards 积分自动化赚取
// @namespace    http://tampermonkey.net/
// @version      0.5.0
// @description  每次搜索赚取3积分，PC端每日90分上限，移动端每日60分上限。
// @author       Pentahydrate
// @match        https://cn.bing.com
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @connect      toutiao.com
// @connect      zhihu.com
// @connect      snssdk.com
// @connect      baidu.com
// @connect      thepaper.cn
// ==/UserScript==

(function () {
    'use strict';

    // 配置参数
    const config = {
        searchBaseUrl: 'https://cn.bing.com/search?q=',
        searchParams: '&form=QBLH',
        minDelay: 10000,
        maxDelay: 15000
    };

    // 数据源配置
    const dataSources = {
        thepaperHot: {
            name: '澎湃新闻【20】',
            apiUrl: 'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar',
            dataProcessor: (response) => {
                const data = JSON.parse(response);
                const hotNews = data.data?.hotNews;
                if (Array.isArray(hotNews)) {
                    return hotNews.map(item => item.name);
                }
                throw new Error('澎湃新闻API返回数据格式不正确');
            }
        },
        zhihuHot: {
            name: '知乎热搜【30】',
            apiUrl: 'https://api.zhihu.com/topstory/hot-lists/total?limit=30',
            dataProcessor: (response) => {
                const data = JSON.parse(response);
                if (Array.isArray(data.data)) {
                    return data.data.map(item => item.target?.title);
                }
                throw new Error('知乎热搜API返回数据格式不正确');
            }
        },
        tiebaHot: {
            name: '贴吧热搜【30】',
            apiUrl: 'https://tieba.baidu.com/hottopic/browse/topicList',
            dataProcessor: (response) => {
                const data = JSON.parse(response);
                const topicList = data.data?.bang_topic?.topic_list;
                if (Array.isArray(topicList)) {
                    return topicList.map(item => item.topic_name);
                }
                throw new Error('贴吧热搜API返回数据格式不正确');
            }
        },
        douyinHot: {
            name: '抖音热搜【50】',
            apiUrl: 'https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880',
            dataProcessor: (response) => {
                const data = JSON.parse(response);
                const wordList = data.data?.word_list;
                if (Array.isArray(wordList)) {
                    return wordList.map(item => item.word);
                }
                throw new Error('抖音热搜API返回数据格式不正确');
            }
        },
        toutiaoHot: {
            name: '头条搜索【50】',
            apiUrl: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
            dataProcessor: (response) => {
                const data = JSON.parse(response);
                if (data.data && Array.isArray(data.data)) {
                    return data.data.map(item => item?.Title);
                }
                throw new Error('头条搜索API返回数据格式不正确');
            }
        }
    };

    // 全局变量
    let newsItems = [];
    let currentIndex = 0;
    let searchInterval = null;
    let menuCommands = [];
    let iframeContainer = null;
    let statusDisplay = null;
    let currentDataSource = null;

    // 初始化UI
    function initUI() {
        // 创建状态显示区域
        statusDisplay = document.createElement('div');
        statusDisplay.style.position = 'fixed';
        statusDisplay.style.top = '10px';
        statusDisplay.style.right = '10px';
        statusDisplay.style.backgroundColor = 'rgba(0,0,0,0.7)';
        statusDisplay.style.color = 'white';
        statusDisplay.style.padding = '8px';
        statusDisplay.style.borderRadius = '4px';
        statusDisplay.style.zIndex = '9999';
        statusDisplay.style.display = 'none';
        document.body.appendChild(statusDisplay);

        // 创建iframe容器 - 简化样式
        iframeContainer = document.createElement('div');
        iframeContainer.style.position = 'fixed';
        iframeContainer.style.top = '0';
        iframeContainer.style.right = '0';
        iframeContainer.style.bottom = '0';
        iframeContainer.style.left = '0';
        iframeContainer.style.backgroundColor = 'white';
        iframeContainer.style.zIndex = '9998';
        iframeContainer.style.display = 'none';

        // 添加iframe
        const iframe = document.createElement('iframe');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.id = 'newsSearchIframe';
        iframeContainer.appendChild(iframe);

        document.body.appendChild(iframeContainer);
    }

    // 注册Tampermonkey菜单命令
    function registerMenuCommands() {
        menuCommands.forEach(cmd => GM_unregisterMenuCommand(cmd.id));
        menuCommands = [];

        Object.keys(dataSources).forEach(sourceKey => {
            const source = dataSources[sourceKey];
            const cmdId = GM_registerMenuCommand(
                `开始${source.name}搜索`,
                () => startSearchProcess(sourceKey)
            );
            menuCommands.push({
                id: cmdId,
                sourceKey
            });
        });

        const stopCmdId = GM_registerMenuCommand('停止当前搜索', stopSearch);
        menuCommands.push({
            id: stopCmdId,
            sourceKey: 'stop'
        });
    }

    // 开始搜索流程
    async function startSearchProcess(sourceKey) {
        try {
            currentDataSource = dataSources[sourceKey];
            newsItems = await fetchNews(currentDataSource);

            if (!newsItems || newsItems.length === 0) {
                GM_notification({
                    title: '错误',
                    text: `没有从${currentDataSource.name}获取到数据`,
                    timeout: 3000
                });
                return;
            }

            currentIndex = 0;
            iframeContainer.style.display = 'block';
            statusDisplay.style.display = 'block';
            searchNextItem();
        } catch (error) {
            console.error('发生错误:', error);
            GM_notification({
                title: '脚本错误',
                text: error.message,
                timeout: 5000
            });
        }
    }

    // 获取新闻数据
    function fetchNews(dataSource) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: dataSource.apiUrl,
                onload: function (response) {
                    try {
                        const items = dataSource.dataProcessor(response.responseText);
                        resolve(items);
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: function (error) {
                    reject(new Error(`获取${dataSource.name}API失败`));
                }
            });
        });
    }

    // 搜索下一个新闻项
    function searchNextItem() {
        if (searchInterval) clearTimeout(searchInterval);

        // 检查是否完成 - 这个检查需要放在执行搜索之前
        if (currentIndex >= newsItems.length) {
            updateStatus('搜索完成');
            GM_notification({
                title: '搜索完成',
                text: `已完成所有 ${newsItems.length} 条${currentDataSource.name}的搜索`,
                timeout: 5000
            });
            return; // 直接返回，不执行后续代码
        }

        const title = newsItems[currentIndex];
        updateStatus(`正在搜索 (${currentIndex + 1}/${newsItems.length})`);

        // 在iframe中加载搜索页面
        const searchUrl = config.searchBaseUrl + encodeURIComponent(title) + config.searchParams;
        document.getElementById('newsSearchIframe').src = searchUrl;

        // 更新索引
        currentIndex++;

        // 只有在还有后续项时才设置下一次搜索
        if (currentIndex < newsItems.length) {
            const delay = getRandomDelay();
            searchInterval = setTimeout(searchNextItem, delay);
        } else {
            // 如果是最后一项，直接显示完成状态
            updateStatus('搜索完成');
            GM_notification({
                title: '搜索完成',
                text: `已完成所有 ${newsItems.length} 条${currentDataSource.name}的搜索`,
                timeout: 5000
            });
        }
    }

    // 停止搜索
    function stopSearch() {
        if (searchInterval) {
            clearTimeout(searchInterval);
            searchInterval = null;
        }
        updateStatus('搜索已停止');
        statusDisplay.style.display = 'none';
        iframeContainer.style.display = 'none';
    }

    // 获取随机延迟时间
    function getRandomDelay() {
        return Math.floor(Math.random() * (config.maxDelay - config.minDelay + 1)) + config.minDelay;
    }

    // 更新状态显示
    function updateStatus(text) {
        statusDisplay.textContent = text;
    }

    // 初始化
    function init() {
        initUI();
        registerMenuCommands();
    }

    // 页面加载完成后初始化
    window.addEventListener('load', function () {
        setTimeout(init, 1000);
    });
})();