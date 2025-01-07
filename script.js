// 全局变量和常量
let timelineData = JSON.parse(localStorage.getItem('timelineData') || '[]');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 5;

// 添加图片压缩函数
function compressImage(base64String, maxWidth = 800) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64String;
        img.onload = function() {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // 计算缩放比例
            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // 压缩图片质量
            resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
    });
}

// 图片预览处理
async function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    const previewContainer = document.getElementById('preview-container');
    previewContainer.innerHTML = '';

    if (files.length > MAX_FILES) {
        showMessage(`最多只能选择${MAX_FILES}张图片`, 'error');
        event.target.value = '';
        return;
    }

    for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
            showMessage(`文件 ${file.name} 超过5MB限制`, 'error');
            continue;
        }

        if (!file.type.startsWith('image/')) {
            showMessage(`文件 ${file.name} 不是图片格式`, 'error');
            continue;
        }

        // 创建预览
        const reader = new FileReader();
        reader.onload = async function(e) {
            // 压缩预览图片
            const compressedPreview = await compressImage(e.target.result, 200); // 预览图片压缩到更小

            const previewDiv = document.createElement('div');
            previewDiv.className = 'preview-item';
            previewDiv.innerHTML = `
                <img src="${compressedPreview}" alt="预览图片">
                <button type="button" class="remove-preview">&times;</button>
            `;
            previewContainer.appendChild(previewDiv);

            previewDiv.querySelector('.remove-preview').addEventListener('click', function() {
                previewDiv.remove();
                if (previewContainer.children.length === 0) {
                    event.target.value = '';
                }
            });
        };
        reader.readAsDataURL(file);
    }
}

// 表单提交处理
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const loadingEl = document.getElementById('loading');
    loadingEl.style.display = 'block';

    try {
        const content = document.getElementById('content').value.trim();
        const userSelect = document.getElementById('user');
        const selectedUser = userSelect.value;

        if (!content) {
            throw new Error('请输入内容');
        }

        const imageInput = document.getElementById('image');
        const files = Array.from(imageInput.files);
        const mediaItems = [];

        // 处理每个文件
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                throw new Error(`文件 ${file.name} 超过5MB限制`);
            }

            // 读取并压缩图片
            const base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsDataURL(file);
            });

            // 压缩图片
            const compressedImage = await compressImage(base64);
            
            mediaItems.push({
                type: 'image',
                url: compressedImage
            });
        }

        const newPost = {
            id: Date.now(),
            user: selectedUser,
            date: new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }),
            content: content,
            media: mediaItems
        };

        // 尝试存储数据
        try {
            // 检查存储空间
            const currentData = JSON.parse(localStorage.getItem('timelineData') || '[]');
            
            // 如果数据太多，删除旧的数据
            while (currentData.length > 50) {
                currentData.pop();
            }
            
            // 添加新数据
            currentData.unshift(newPost);
            
            // 尝试存储
            const dataString = JSON.stringify(currentData);
            try {
                localStorage.setItem('timelineData', dataString);
                timelineData = currentData;
            } catch (e) {
                // 如果还是失败，继续删除旧数据直到能存储为止
                while (currentData.length > 1) {
                    currentData.pop();
                    try {
                        localStorage.setItem('timelineData', JSON.stringify(currentData));
                        timelineData = currentData;
                        break;
                    } catch (err) {
                        continue;
                    }
                }
            }
        } catch (storageError) {
            throw new Error('存储空间不足，请删除一些旧的内容');
        }

        // 重新渲染
        renderTimeline();

        // 重置表单
        const form = document.getElementById('post-form');
        form.reset();
        document.getElementById('preview-container').innerHTML = '';

        showMessage('发布成功！');

    } catch (error) {
        showMessage(error.message, 'error');
    } finally {
        loadingEl.style.display = 'none';
    }
}

// 图片预览功能
function showImagePreview(imgElement, event) {
    // 阻止事件冒泡
    if (event) event.stopPropagation();
    
    // 获取点击图片的位置和尺寸
    const rect = imgElement.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    
    // 创建预览容器
    const previewContainer = document.createElement('div');
    previewContainer.className = 'image-preview-container';
    
    // 设置预览容器的初始位置（与原图位置相同）
    previewContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
        background-color: rgba(0, 0, 0, 0.9);
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    
    // 创建预览图片
    const previewImage = document.createElement('img');
    previewImage.className = 'preview-image';
    previewImage.src = imgElement.src;
    previewImage.style.cssText = `
        max-width: 90%;
        max-height: 90vh;
        object-fit: contain;
        transform: scale(0.9);
        transition: all 0.3s ease;
        cursor: zoom-out;
    `;
    
    // 创建关闭按钮
    const closeButton = document.createElement('button');
    closeButton.className = 'close-preview';
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        color: white;
        font-size: 30px;
        cursor: pointer;
        background: none;
        border: none;
        padding: 10px;
        z-index: 1001;
    `;
    
    // 组装预览元素
    previewContainer.appendChild(previewImage);
    previewContainer.appendChild(closeButton);
    document.body.appendChild(previewContainer);
    
    // 触发动画
    requestAnimationFrame(() => {
        previewContainer.style.opacity = '1';
        previewImage.style.transform = 'scale(1)';
    });
    
    // 关闭预览的函数
    const closePreview = (e) => {
        if (e) e.stopPropagation();
        previewContainer.style.opacity = '0';
        previewImage.style.transform = 'scale(0.9)';
        setTimeout(() => {
            previewContainer.remove();
        }, 300);
    };
    
    // 添加事件监听
    closeButton.onclick = closePreview;
    previewContainer.onclick = (e) => {
        if (e.target === previewContainer) {
            closePreview();
        }
    };
    
    // 添加键盘事件监听
    const handleEsc = (e) => {
        if (e.key === 'Escape') {
            closePreview();
            document.removeEventListener('keydown', handleEsc);
        }
    };
    document.addEventListener('keydown', handleEsc);
}

// 修改渲染时间线中的图片点击事件
function renderTimeline() {
    const timeline = document.querySelector('.timeline');
    timeline.innerHTML = '';
    
    timelineData.forEach((post, index) => {
        const positionClass = index % 2 === 0 ? 'left' : 'right';
        
        const mediaHTML = post.media && post.media.length > 0 
            ? `<div class="timeline-media">
                ${post.media.map(item => `
                    <img src="${item.url}" alt="上传图片" onclick="showImagePreview(this, event)">
                `).join('')}
               </div>`
            : '';

        const postHTML = `
            <div class="timeline-item ${positionClass}">
                <div class="timeline-content">
                    <div class="timeline-header">
                        <div class="timeline-user">${post.user}</div>
                        <div class="timeline-date">${post.date}</div>
                        <button class="delete-btn" onclick="deletePost(${index})">×</button>
                    </div>
                    <div class="timeline-text">${post.content}</div>
                    ${mediaHTML}
                </div>
            </div>
        `;
        
        timeline.insertAdjacentHTML('beforeend', postHTML);
    });
}

// 显示消息提示
function showMessage(message, type = 'success') {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    messageEl.textContent = message;
    document.body.appendChild(messageEl);
    
    setTimeout(() => messageEl.remove(), 3000);
}

// 删除帖子
function deletePost(index) {
    if (confirm('确定要删除这条内容吗？')) {
        timelineData.splice(index, 1);
        localStorage.setItem('timelineData', JSON.stringify(timelineData));
        renderTimeline();
        showMessage('删除成功');
    }
}

// 初始化事件监听
document.addEventListener('DOMContentLoaded', () => {
    // 渲染现有内容
    renderTimeline();

    // 添加文件选择监听
    const imageInput = document.getElementById('image');
    if (imageInput) {
        imageInput.addEventListener('change', handleFileSelect);
    }

    // 添加表单提交监听
    const form = document.getElementById('post-form');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }
});
