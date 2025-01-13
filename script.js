// 全局变量
let timelineData = [];
let uploadedImages = [];
let currentUser = null;
let mediaRecorder = null;
let audioChunks = [];
let recordedAudios = [];
let isRecording = false;

// 提交帖子函数
function submitPost() {
    try {
        console.log('开始提交帖子...');
        
        const content = document.getElementById('content').value;
        const timestamp = Date.now();

        if (!currentUser) {
            showMessage('请先选择身份！', 'error');
            showIdentityModal();
            return;
        }

        if (!content.trim()) {
            showMessage('请输入内容！', 'error');
            return;
        }

        // 显示加载提示
        document.getElementById('loading').style.display = 'block';

        const newPost = {
            id: String(timestamp),
            content: content,
            user: currentUser,
            timestamp: timestamp,
            images: uploadedImages || [],
            audios: recordedAudios || [],
            replies: []
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
                recordedAudios = [];
                document.getElementById('audioPreview').innerHTML = '';
            })
            .catch(error => {
                console.error('提交失败:', error);
                document.getElementById('loading').style.display = 'none';
                showMessage('发布失败: ' + error.message, 'error');
            });
    } catch (error) {
        console.error('提交出错:', error);
        showMessage('发布失败，请稍后重试', 'error');
    }
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
        console.log('开始加载帖子...');
        
        // 显示加载状态
        const timelineEl = document.querySelector('.timeline');
        timelineEl.innerHTML = '<div class="loading-posts">加载中...</div>';
        
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
                timelineEl.innerHTML = '<div class="timeline-empty">加载失败，请稍后重试 ❌</div>';
            });
    }, 300);
}

// 删除帖子函数
function deletePost(postId) {
    console.log('尝试删除帖子:', postId);
    // 获取帖子信息
    firebase.database().ref('posts/' + postId).once('value')
        .then(snapshot => {
            const post = snapshot.val();
            if (!post) {
                showMessage('帖子不存在', 'error');
                return;
            }
            
            // 检查权限
            if (post.user !== currentUser) {
                showMessage('只能删除自己的帖子', 'error');
                return;
            }
            
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
        });
}

// 处理图片上传
function handleImageUpload(event) {
    const files = event.target.files;
    const maxSize = 5 * 1024 * 1024; // 5MB
    const previewContainer = document.getElementById('preview-container');
    
    Array.from(files).forEach(file => {
        if (file.size > maxSize) {
            showMessage('图片大小不能超过5MB', 'error');
            return;
        }
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
                            ${item.audios && item.audios.length ? `
                                <div class="timeline-audio">
                                    ${item.audios.map(audio => `
                                        <audio controls src="${audio}"></audio>
                                    `).join('')}
                                </div>
                            ` : ''}
                            <div class="timeline-footer">
                                ${item.user === currentUser ? `
                                    <button class="delete-btn" onclick="deletePost('${item.id}')">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                ` : ''}
                            </div>
                            <div class="replies-section">
                                <div class="replies-list ${item.replies && item.replies.length ? 'expanded' : ''}">
                                    <div class="replies-header">
                                        <button class="replies-toggle" onclick="toggleReplies(this)" data-post-id="${item.id}">
                                            <i class="fas fa-chevron-down"></i>
                                            ${(item.replies && item.replies.length) ? item.replies.length : 0}条回复
                                        </button>
                                    </div>
                                    <div class="replies-content">
                                        ${(item.replies && item.replies.length) ? item.replies.map(reply => `
                                            <div class="reply-item" data-user="${reply.user}">
                                                <div class="reply-header">
                                                    <span class="reply-user">
                                                        ${reply.user === '晁森豪' ? '🤴 ' : '👸 '}
                                                        ${reply.user}
                                                    </span>
                                                    <span class="reply-content">${reply.content}</span>
                                                    ${reply.user === currentUser ? `
                                                        <button class="delete-reply-btn" onclick="deleteReply('${item.id}', ${reply.id})">
                                                            <i class="fas fa-times"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                                <div class="reply-date">
                                                    ${formatDate(reply.timestamp)}
                                                </div>
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                </div>
                                
                                <div class="reply-form">
                                    <input type="text" 
                                           id="reply-input-${item.id}" 
                                           class="reply-input" 
                                           placeholder="写下你的回复..."
                                           onkeypress="handleReplyEnter(event, '${item.id}')">
                                    <button onclick="submitReply('${item.id}')" class="reply-btn">
                                        回复
                                    </button>
                                </div>
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

// 身份选择相关函数
function showIdentityModal() {
    const modal = document.getElementById('identity-modal');
    const mainContent = document.getElementById('main-content');
    modal.classList.add('show');
    mainContent.style.display = 'none';
}

function hideIdentityModal() {
    const modal = document.getElementById('identity-modal');
    const mainContent = document.getElementById('main-content');
    modal.classList.remove('show');
    setTimeout(() => {
        mainContent.style.display = 'block';
    }, 300);
}

function selectIdentity(user) {
    if (!user || (user !== '晁森豪' && user !== '孙佳乐')) {
        showMessage('请选择正确的身份！', 'error');
        showIdentityModal();
        return;
    }
    
    currentUser = user;
    document.getElementById('current-user').textContent = user;
    localStorage.setItem('currentUser', user);
    hideIdentityModal();
    loadPosts();
}

// 添加回复功能
function submitReply(postId) {
    const replyContent = document.getElementById(`reply-input-${postId}`).value;
    
    if (!currentUser) {
        showMessage('请先选择身份！', 'error');
        showIdentityModal();
        return;
    }

    if (!replyContent.trim()) {
        showMessage('请输入回复内容！', 'error');
        return;
    }

    const reply = {
        id: Date.now(),
        content: replyContent,
        user: currentUser,
        timestamp: Date.now()
    };

    // 显示加载状态
    const replyBtn = document.querySelector(`#reply-input-${postId}`).nextElementSibling;
    const originalText = replyBtn.innerHTML;
    replyBtn.innerHTML = '发送中...';
    replyBtn.disabled = true;

    // 获取当前帖子的回复数组
    firebase.database().ref(`posts/${postId}/replies`).once('value')
        .then(snapshot => {
            const replies = snapshot.val() || [];
            replies.push(reply);
            
            // 更新回复
            return firebase.database().ref(`posts/${postId}/replies`).set(replies);
        })
        .then(() => {
            document.getElementById(`reply-input-${postId}`).value = '';
            showMessage('回复成功！', 'success');
            // 只更新当前帖子的回复部分
            firebase.database().ref(`posts/${postId}`).once('value')
                .then(snapshot => {
                    const post = snapshot.val();
                    const repliesSection = document.querySelector(`[data-post-id="${postId}"]`).closest('.replies-section');
                    const repliesList = repliesSection.querySelector('.replies-list');
                    
                    repliesList.innerHTML = `
                        <div class="replies-header">
                            <button class="replies-toggle expanded" onclick="toggleReplies(this)" data-post-id="${postId}">
                                <i class="fas fa-chevron-down"></i>
                                ${post.replies ? post.replies.length : 0}条回复
                            </button>
                        </div>
                        <div class="replies-content">
                            ${post.replies.map(reply => `
                                <div class="reply-item" data-user="${reply.user}">
                                    <div class="reply-header">
                                        <span class="reply-user">
                                            ${reply.user === '晁森豪' ? '🤴 ' : '👸 '}
                                            ${reply.user}
                                        </span>
                                        <span class="reply-content">${reply.content}</span>
                                        ${reply.user === currentUser ? `
                                            <button class="delete-reply-btn" onclick="deleteReply('${item.id}', ${reply.id})">
                                                <i class="fas fa-times"></i>
                                            </button>
                                        ` : ''}
                                    </div>
                                    <div class="reply-date">
                                        ${formatDate(reply.timestamp)}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    repliesList.classList.add('expanded');
                });
        })
        .catch(error => {
            console.error('回复失败:', error);
            showMessage('回复失败: ' + error.message, 'error');
        })
        .finally(() => {
            // 恢复按钮状态
            replyBtn.innerHTML = originalText;
            replyBtn.disabled = false;
        });
}

// 修改回复展开/收起功能
function toggleReplies(button) {
    const repliesList = button.closest('.replies-list');
    button.classList.toggle('expanded');
    repliesList.classList.toggle('expanded');
}

// 添加回车发送回复功能
function handleReplyEnter(event, postId) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitReply(postId);
    }
}

// 添加删除回复函数
function deleteReply(postId, replyId) {
    if (!currentUser) {
        showMessage('请先选择身份！', 'error');
        showIdentityModal();
        return;
    }

    firebase.database().ref(`posts/${postId}`).once('value')
        .then(snapshot => {
            const post = snapshot.val();
            if (!post || !post.replies) {
                showMessage('回复不存在', 'error');
                return;
            }

            // 找到要删除的回复
            const replyIndex = post.replies.findIndex(reply => reply.id === replyId);
            if (replyIndex === -1) {
                showMessage('回复不存在', 'error');
                return;
            }

            // 检查权限
            if (post.replies[replyIndex].user !== currentUser) {
                showMessage('只能删除自己的回复', 'error');
                return;
            }

            if (confirm('确定要删除这条回复吗？')) {
                // 删除回复
                post.replies.splice(replyIndex, 1);
                
                // 更新数据库
                firebase.database().ref(`posts/${postId}/replies`).set(post.replies)
                    .then(() => {
                        showMessage('删除成功！', 'success');
                        // 更新界面
                        const repliesSection = document.querySelector(`[data-post-id="${postId}"]`).closest('.replies-section');
                        const repliesList = repliesSection.querySelector('.replies-list');
                        repliesList.innerHTML = `
                            <div class="replies-header">
                                <button class="replies-toggle expanded" onclick="toggleReplies(this)" data-post-id="${postId}">
                                    <i class="fas fa-chevron-down"></i>
                                    ${post.replies.length}条回复
                                </button>
                            </div>
                            <div class="replies-content">
                                ${post.replies.map(reply => `
                                    <div class="reply-item" data-user="${reply.user}">
                                        <div class="reply-header">
                                            <span class="reply-user">
                                                ${reply.user === '晁森豪' ? '🤴 ' : '👸 '}
                                                ${reply.user}
                                            </span>
                                            <span class="reply-content">${reply.content}</span>
                                            ${reply.user === currentUser ? `
                                                <button class="delete-reply-btn" onclick="deleteReply('${postId}', ${reply.id})">
                                                    <i class="fas fa-times"></i>
                                                </button>
                                            ` : ''}
                                        </div>
                                        <div class="reply-date">
                                            ${formatDate(reply.timestamp)}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                    })
                    .catch(error => {
                        console.error('删除回复失败:', error);
                        showMessage('删除失败: ' + error.message, 'error');
                    });
            }
        });
}

// 初始化录音功能
function initializeRecording() {
    const recordButton = document.getElementById('recordButton');
    const recordingStatus = document.getElementById('recordingStatus');
    
    // 检查设备支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        recordButton.disabled = true;
        recordingStatus.textContent = '您的设备不支持录音功能';
        return;
    }
    
    recordButton.addEventListener('click', toggleRecording);
}

// 切换录音状态
async function toggleRecording() {
    const recordButton = document.getElementById('recordButton');
    const recordingStatus = document.getElementById('recordingStatus');
    
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                const audioUrl = URL.createObjectURL(audioBlob);
                addAudioPreview(audioUrl);
                recordedAudios.push(audioUrl);
            };
            
            mediaRecorder.start();
            isRecording = true;
            recordButton.classList.add('recording');
            recordButton.innerHTML = '<i class="fas fa-stop"></i> 停止录音';
            recordingStatus.textContent = '正在录音...';
        } catch (error) {
            console.error('录音失败:', error);
            showMessage('无法访问麦克风', 'error');
        }
    } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        recordButton.classList.remove('recording');
        recordButton.innerHTML = '<i class="fas fa-microphone"></i> 开始录音 🎤';
        recordingStatus.textContent = '';
    }
}

// 添加录音预览
function addAudioPreview(audioUrl) {
    const audioPreview = document.getElementById('audioPreview');
    const audioItem = document.createElement('div');
    audioItem.className = 'audio-item';
    audioItem.innerHTML = `
        <audio controls src="${audioUrl}"></audio>
        <button class="remove-audio" onclick="removeAudio(this)">×</button>
    `;
    audioPreview.appendChild(audioItem);
}

// 移除录音
function removeAudio(button) {
    const audioItem = button.parentElement;
    const audioPreview = audioItem.parentElement;
    const index = Array.from(audioPreview.children).indexOf(audioItem);
    recordedAudios.splice(index, 1);
    audioItem.remove();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('页面加载完成，初始化...');
    
    // 先隐藏主内容
    const mainContent = document.getElementById('main-content');
    mainContent.style.display = 'none';
    
    // 检查是否已选择身份
    const savedUser = localStorage.getItem('currentUser');
    
    if (!savedUser) {
        // 清除可能存在的用户信息
        currentUser = null;
        localStorage.removeItem('currentUser');
        showIdentityModal();
    } else {
        // 验证保存的身份是否有效
        if (savedUser === '晁森豪' || savedUser === '孙佳乐') {
            selectIdentity(savedUser);
        } else {
            localStorage.removeItem('currentUser');
            showIdentityModal();
        }
    }
    
    // 添加图片上传监听器
    document.getElementById('image').addEventListener('change', handleImageUpload);
    
    // 添加表单提交监听器
    document.getElementById('post-form').addEventListener('submit', (e) => {
        e.preventDefault();
        submitPost();
    });
    
    // 初始化录音功能
    initializeRecording();
});
