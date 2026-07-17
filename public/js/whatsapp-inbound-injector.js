// WhatsApp Inbound Chat Injector for admin-dashboard.html
(function() {
  if (!document.getElementById('whatsappTab')) return;
  
  const chatSection = document.createElement('div');
  chatSection.innerHTML = `
    <div class="mb-6">
      <h4 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <i class="fab fa-whatsapp text-green-600 mr-2"></i>
        Chat WhatsApp Orangtua
      </h4>
      
      <div class="flex space-x-2 mb-3">
        <button onclick="loadInboundMessages()" class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
          <i class="fas fa-inbox mr-1"></i> Pesan Masuk
        </button>
        <button onclick="loadInboundConversations()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <i class="fas fa-comments mr-1"></i> Percakapan
        </button>
      </div>
      
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="bg-white border border-gray-200 rounded-lg" id="inboundConversationsPanel">
          <div class="p-3 border-b border-gray-200">
            <input type="text" id="inboundSearch" placeholder="Cari nomor..." 
              class="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              onkeyup="if(event.key==='Enter') loadInboundConversations()">
          </div>
          <div id="inboundConversationsList" class="max-h-96 overflow-y-auto">
            <p class="p-4 text-center text-gray-500 text-sm">Memuat...</p>
          </div>
        </div>
        
        <div class="lg:col-span-2">
          <div id="inboundMessagesView" class="bg-white border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
            <p class="p-4 text-center text-gray-400">Pilih percakapan untuk melihat pesan</p>
          </div>
          
          <div class="mt-2 flex space-x-2">
            <input type="text" id="inboundReplyMessage" placeholder="Ketik balasan..." 
              class="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" disabled>
            <button onclick="sendInboundReply()" class="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700" disabled id="inboundSendBtn">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const parent = document.getElementById('whatsappTab');
  if (parent) {
    parent.insertBefore(chatSection, parent.firstChild);
  }
  
  window.WhatsAppInbound = {
    selectedPhone: null,
    authToken: localStorage.getItem('token') || '',
    
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
    
    async loadConversations() {
      const container = document.getElementById('inboundConversationsList');
      const search = document.getElementById('inboundSearch')?.value || '';
      
      container.innerHTML = '<p class="p-4 text-center text-gray-500 text-sm">Memuat...</p>';
      
      try {
        const res = await fetch(`/api/whatsapp/inbound/conversations?search=${encodeURIComponent(search)}`, {
          headers: { 'Authorization': 'Bearer ' + this.authToken }
        });
        const data = await res.json();
        
        if (data.success) {
          container.innerHTML = data.conversations?.length 
            ? data.conversations.map(c => `
              <div class="p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onclick="WhatsAppInbound.selectConversation('${c.from_phone}')">
                <div class="flex justify-between items-start">
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-800 truncate text-sm">${c.profile_name || c.from_phone}</p>
                    <p class="text-xs text-gray-500 truncate">${c.last_message || ''}</p>
                  </div>
                  <span class="text-xs text-gray-400 ml-2">${this.formatTime(c.last_time)}</span>
                </div>
                <p class="text-xs text-gray-600 mt-1">${c.from_phone}</p>
              </div>
            `).join('')
            : '<p class="p-4 text-center text-gray-500 text-sm">Belum ada percakapan</p>';
        }
      } catch (e) {
        container.innerHTML = '<p class="p-4 text-center text-red-500 text-sm">Gagal memuat</p>';
      }
    },
    
    async selectConversation(phone) {
      this.selectedPhone = phone;
      const replyInput = document.getElementById('inboundReplyMessage');
      const sendBtn = document.getElementById('inboundSendBtn');
      
      if (replyInput) replyInput.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      
      try {
        const res = await fetch(`/api/whatsapp/inbound/conversations/${phone}/messages`, {
          headers: { 'Authorization': 'Bearer ' + this.authToken }
        });
        const data = await res.json();
        
        const container = document.getElementById('inboundMessagesView');
        if (data.success) {
          container.innerHTML = data.messages?.length
            ? data.messages.map(m => `
              <div class="p-3 border-b border-gray-100">
                <div class="flex justify-between">
                  <span class="text-xs font-medium text-gray-700">${m.profile_name || m.from_phone}</span>
                  <span class="text-xs text-gray-400">${this.formatTime(m.created_at)}</span>
                </div>
                <p class="text-sm text-gray-800 mt-1">${this.escapeHtml(m.message)}</p>
                <span class="text-xs px-2 py-0.5 rounded ${m.status === 'replied' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">${m.status}</span>
              </div>
            `).join('')
            : '<p class="p-4 text-center text-gray-400">Belum ada pesan</p>';
        }
      } catch (e) {
        document.getElementById('inboundMessagesView').innerHTML = '<p class="p-4 text-center text-red-500">Gagal memuat pesan</p>';
      }
    },
    
    async sendMessage() {
      const msg = document.getElementById('inboundReplyMessage')?.value.trim();
      if (!msg || !this.selectedPhone) return;
      
      try {
        const res = await fetch('/api/whatsapp/inbound/send', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this.authToken
          },
          body: JSON.stringify({ to: this.selectedPhone, message: msg })
        });
        const data = await res.json();
        
        if (data.success) {
          document.getElementById('inboundReplyMessage').value = '';
          this.selectConversation(this.selectedPhone);
        } else {
          alert(data.message || 'Gagal mengirim balasan');
        }
      } catch (e) {
        alert('Gagal mengirim balasan');
      }
    },
    
    formatTime(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      return d.toLocaleDateString('id-ID') + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
  };
  
  window.loadInboundConversations = () => window.WhatsAppInbound.loadConversations();
  window.selectInboundConversation = (phone) => window.WhatsAppInbound.selectConversation(phone);
  window.sendInboundReply = () => window.WhatsAppInbound.sendMessage();
  window.loadInboundMessages = () => window.WhatsAppInbound.loadConversations();
})();