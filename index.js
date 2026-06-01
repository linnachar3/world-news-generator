jQuery(async () => {
    // 创建一个带有复古粗线条风格的按钮
    const newsButton = $('<button id="world-news-btn" style="position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:9999; padding:8px 16px; background-color:#f4f4f0; color:#1a1a1a; border:2px solid #1a1a1a; box-shadow: 4px 4px 0px #1a1a1a; font-weight:bold; cursor:pointer; font-family:serif;">📰 世界新闻中心</button>');

    // 把按钮塞进页面的主体中
    $('body').append(newsButton);

    // 给按钮绑定一个点击事件
    newsButton.on('click', function() {
        alert("世界背景框架已就绪，准备接入世界书！");
    });
});
