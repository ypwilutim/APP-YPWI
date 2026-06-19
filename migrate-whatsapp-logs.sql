CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nomor_tujuan VARCHAR(20) NOT NULL,
    template_pesan VARCHAR(50),
    pesan TEXT,
    jenis_pesan ENUM('template', 'text', 'flash') DEFAULT 'template',
    status_pengiriman ENUM('sent', 'delivered', 'read', 'failed', 'pending') DEFAULT 'pending',
    message_id VARCHAR(255),
    error_message TEXT,
    id_guru INT,
    id_tenant INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (id_guru) REFERENCES teachers(id),
    FOREIGN KEY (id_tenant) REFERENCES tenants(tenant_id)
);

CREATE INDEX idx_whatsapp_logs_status ON whatsapp_logs(status_pengiriman);
CREATE INDEX idx_whatsapp_logs_created_at ON whatsapp_logs(created_at);
