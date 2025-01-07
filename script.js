// 全局变量
let timelineData = [];
let uploadedImages = [];

// 提交帖子函数
function submitPost() {
    console.log('开始提交帖子...');
    
    const content = document.getElementById('content').value;
    const user = document.getElementById('user').value;
    const timestamp = Date.now();

    if (!content.trim()) {
        showMessage('请输入内容！', 'error');
        return;
    }

    // 显示加载提示
    document.getElementById('loading').style.display = 'block';

    const newPost = {
        id: String(timestamp),
        content: content,
        user: user,
        timestamp: timestamp,
        images: uploadedImages || []
    };

    console.log('准备提交的数据:', newPost);

    // 保存到 Firebase
    firebase.database().ref('posts/' + newPost.id).set(newPost)
        .then(() => {
            console.log('帖子提交成功');
            document.getElementById('content').value = '';
            uploadedImages = [];
            document.getElementById('preview-container').innerHTML = '';
            document.getElementById('loading').style.display = 'none';
            showMessage('发布成功！', 'success');
            loadPosts();
        })
        .catch(error => {
            console.error('提交失败:', error);
            document.getElementById('loading').style.display = 'none';
            showMessage('发布失败: ' + error.message, 'error');
        });
}

// 格式化时间函数
function formatDate(timestamp) {
    const date = new Date(Number(timestamp));
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

// 加载帖子函数
function loadPosts() {
    console.log('开始加载帖子...');
    
    firebase.database().ref('posts').once('value')
        .then(snapshot => {
            const data = snapshot.val();
            console.log('获取到的原始数据:', data);
            
            if (!data) {
                console.log('没有找到帖子数据');
                timelineData = [];
                renderTimeline();
                return;
            }

            // 转换对象为数组
            timelineData = Object.values(data);
            
            // 排序
            timelineData.sort((a, b) => b.timestamp - a.timestamp);
            
            console.log('处理后的数据:', timelineData);
            
            renderTimeline();
        })
        .catch(error => {
            console.error('加载帖子失败:', error);
            showMessage('加载失败: ' + error.message, 'error');
        });
}

// 删除帖子函数
function deletePost(postId) {
    console.log('尝试删除帖子:', postId);
    if (confirm('确定要删除这条记录吗？')) {
        firebase.database().ref('posts/' + postId).remove()
            .then(() => {
                console.log('删除成功');
                showMessage('删除成功！', 'success');
                loadPosts();
            })
            .catch(error => {
                console.error('删除失败:', error);
                showMessage('删除失败: ' + error.message, 'error');
            });
    }
}

// 处理图片上传
function handleImageUpload(event) {
    const files = event.target.files;
    const previewContainer = document.getElementById('preview-container');
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const imageUrl = e.target.result;
            uploadedImages.push(imageUrl);
            
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            previewItem.innerHTML = `
                <img src="${imageUrl}" alt="预览图片">
                <button class="remove-preview" onclick="removePreview(this)">×</button>
            `;
            previewContainer.appendChild(previewItem);
        };
        
        reader.readAsDataURL(file);
    });
}

// 移除预览图片
function removePreview(button) {
    const previewItem = button.parentElement;
    const previewContainer = previewItem.parentElement;
    const index = Array.from(previewContainer.children).indexOf(previewItem);
    uploadedImages.splice(index, 1);
    previewItem.remove();
}

// 图片预览功能
function showImagePreview(imageUrl) {
    const previewContainer = document.createElement('div');
    previewContainer.className = 'image-preview-container';
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'preview-image';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'close-preview';
    closeButton.innerHTML = '×';
    
    closeButton.onclick = () => previewContainer.remove();
    previewContainer.onclick = (e) => {
        if (e.target === previewContainer) {
            previewContainer.remove();
        }
    };
    
    previewContainer.appendChild(img);
    previewContainer.appendChild(closeButton);
    document.body.appendChild(previewContainer);
}

// 按年月日分组帖子
function groupPostsByDate(posts) {
    const groups = {};
    posts.forEach(post => {
        const date = new Date(Number(post.timestamp));
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        if (!groups[year]) {
            groups[year] = {};
        }
        if (!groups[year][month]) {
            groups[year][month] = {};
        }
        if (!groups[year][month][day]) {
            groups[year][month][day] = [];
        }
        groups[year][month][day].push(post);
    });
    return groups;
}

// 渲染时间线
function renderTimeline() {
    const timelineEl = document.querySelector('.timeline');
    
    if (!timelineData.length) {
        timelineEl.innerHTML = '<div class="timeline-empty">还没有任何记录哦 ✨</div>';
        return;
    }

    // 按日期分组
    const groupedPosts = groupPostsByDate(timelineData);
    
    // 生成HTML
    let html = '';
    
    // 遍历年份
    Object.keys(groupedPosts).sort((a, b) => b - a).forEach(year => {
        html += `
            <div class="timeline-year-divider timeline-divider">
                <span>${year}年</span>
            </div>
        `;
        
        // 遍历月份
        Object.keys(groupedPosts[year]).sort((a, b) => b - a).forEach(month => {
            html += `
                <div class="timeline-month-divider timeline-divider">
                    <span>${month}月</span>
                </div>
            `;
            
            // 遍历日期
            Object.keys(groupedPosts[year][month]).sort((a, b) => b - a).forEach(day => {
                html += `
                    <div class="timeline-date-divider timeline-divider">
                        <span>${day}日</span>
                    </div>
                `;
                
                // 渲染当天的帖子
                groupedPosts[year][month][day].forEach(item => {
                    html += `
                        <div class="timeline-item" data-user="${item.user}">
                            <div class="timeline-header">
                                <div class="timeline-user">
                                    ${item.user === '晁森豪' ? '🤴 ' : '👸 '}
                                    ${item.user} 
                                    ${item.user === '晁森豪' ? ' 💫' : ' ✨'}
                                </div>
                                <div class="timeline-date">
                                    🕐 ${formatDate(item.timestamp)} ⌛
                                </div>
                            </div>
                            <div class="timeline-text">
                                ${item.content.split('\n').map(line => `<p>${line}</p>`).join('')}
                            </div>
                            ${item.images && item.images.length ? `
                                <div class="timeline-media">
                                    ${item.images.map(img => `
                                        <img src="${img}" 
                                             alt="照片" 
                                             onclick="showImagePreview('${img}')"
                                             style="cursor: pointer;">
                                    `).join('')}
                                </div>
                            ` : ''}
                            <div class="timeline-footer">
                                <button class="delete-btn" onclick="deletePost('${item.id}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                });
            });
        });
    });
    
    timelineEl.innerHTML = html;
}

// 显示消息提示
function showMessage(message, type) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = message;
    document.body.appendChild(messageEl);
    
    setTimeout(() => {
        messageEl.remove();
    }, 3000);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('页面加载完成，初始化...');
    
    // 添加图片上传监听器
    document.getElementById('image').addEventListener('change', handleImageUpload);
    
    // 添加表单提交监听器
    document.getElementById('post-form').addEventListener('submit', (e) => {
        e.preventDefault();
        submitPost();
    });
    
    // 初始加载帖子
    loadPosts();
});
