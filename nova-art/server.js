const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

let users = {};

const wordPool = [
    { word: "Pizza", category: "Yiyecek" }, { word: "Hamburger", category: "Yiyecek" },
    { word: "Makarna", category: "Yiyecek" }, { word: "Baklava", category: "Yiyecek" },
    { word: "Döner", category: "Yiyecek" }, { word: "Tost", category: "Yiyecek" },
    { word: "Ayran", category: "İçecek" }, { word: "Limonata", category: "İçecek" },
    { word: "Kahve", category: "İçecek" }, { word: "Çay", category: "İçecek" },
    { word: "Kedi", category: "Hayvan" }, { word: "Köpek", category: "Hayvan" },
    { word: "Muhabbet Kuşu", category: "Hayvan" }, { word: "Aslan", category: "Hayvan" },
    { word: "Masa", category: "Eşya" }, { word: "Sandalye", category: "Eşya" },
    { word: "Kalem", category: "Eşya" }, { word: "Gözlük", category: "Eşya" },
    { word: "Bilgisayar", category: "Teknoloji" }, { word: "Telefon", category: "Teknoloji" },
    { word: "Klavye", category: "Teknoloji" }, { word: "Yazılım", category: "Teknoloji" }
];

let currentWordObj = { word: "", category: "" };
let drawerId = null;
let guessedUsers = new Set();
let timeLeft = 90; // 1 dakika 30 saniye (90 saniye)
let timerInterval = null;

function temizle(metin) {
    return metin.trim().toLowerCase()
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ç/g, 'c')
        .replace(/ğ/g, 'g');
}

function startNewRound() {
    // Mevcut zamanlayıcıyı temizle
    clearInterval(timerInterval);

    const userIds = Object.keys(users);
    if (userIds.length < 2) {
        drawerId = userIds[0] || null;
        currentWordObj = { word: "", category: "" };
        guessedUsers.clear();
        io.emit('system-message', "Oyunun başlaması için en az 2 oyuncu gerekiyor.");
        io.emit('timer-update', 0);
        if (drawerId) {
            io.to(drawerId).emit('role-assignment', { isDrawer: true, word: "Oyuncu Bekleniyor...", category: "" });
        }
        return;
    }

    let currentIndex = userIds.indexOf(drawerId);
    let nextIndex = (currentIndex + 1) % userIds.length;
    drawerId = userIds[nextIndex];

    currentWordObj = wordPool[Math.floor(Math.random() * wordPool.length)];
    guessedUsers.clear();
    timeLeft = 90; // Süreyi 90 saniyeye sıfırla

    io.emit('clear-canvas');

    userIds.forEach(id => {
        if (id === drawerId) {
            io.to(id).emit('role-assignment', { isDrawer: true, word: currentWordObj.word, category: currentWordObj.category });
        } else {
            io.to(id).emit('role-assignment', { isDrawer: false, word: null, category: currentWordObj.category });
        }
    });

    io.emit('system-message', `Yeni tur başladı! Kategori: <strong>${currentWordObj.category}</strong>`);

    // Geri sayımı başlat
    timerInterval = setInterval(() => {
        timeLeft--;
        io.emit('timer-update', timeLeft);

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            io.emit('system-message', `Süre bitti! Doğru kelime: <strong>${currentWordObj.word}</strong> idi.`);
            setTimeout(() => {
                startNewRound();
            }, 3000);
        }
    }, 1000);
}

io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        users[socket.id] = { username, score: 0 };
        if (!drawerId) drawerId = socket.id;
        io.emit('update-players', Object.values(users));
        
        if (Object.keys(users).length === 2 && !timerInterval) {
            startNewRound();
        } else {
            socket.emit('role-assignment', { 
                isDrawer: socket.id === drawerId, 
                word: socket.id === drawerId ? (currentWordObj.word || "Bekleniyor...") : null,
                category: currentWordObj.category || ""
            });
            socket.emit('timer-update', timeLeft);
        }
    });

    socket.on('drawing', (data) => {
        if (socket.id === drawerId) {
            socket.broadcast.emit('drawing', data);
        }
    });

    socket.on('clear-canvas', () => {
        if (socket.id === drawerId) io.emit('clear-canvas');
    });

    socket.on('send-message', (msg) => {
        const user = users[socket.id];
        if (!user) return;

        if (temizle(msg) === temizle(currentWordObj.word)) {
            if (socket.id !== drawerId && !guessedUsers.has(socket.id)) {
                user.score += 10;
                guessedUsers.add(socket.id);
                
                io.emit('system-message', `${user.username} doğru tahmin etti! Kelime: ${currentWordObj.word}`);
                io.emit('update-players', Object.values(users));

                const totalGuessers = Object.keys(users).length - 1;
                if (guessedUsers.size >= totalGuessers) {
                    clearInterval(timerInterval);
                    io.emit('system-message', `Herkes doğru bildi! 3 saniye içinde yeni tura geçiliyor...`);
                    setTimeout(() => { startNewRound(); }, 3000);
                }
            }
        } else {
            io.emit('chat-message', { username: user.username, message: msg });
        }
    });

    socket.on('disconnect', () => {
        const wasDrawer = (drawerId === socket.id);
        delete users[socket.id];
        guessedUsers.delete(socket.id);
        io.emit('update-players', Object.values(users));

        if (Object.keys(users).length < 2) {
            clearInterval(timerInterval);
            timerInterval = null;
            drawerId = Object.keys(users)[0] || null;
            currentWordObj = { word: "", category: "" };
            io.emit('system-message', "Oyuncu sayısı yetersiz olduğundan oyun durduruldu.");
            io.emit('timer-update', 0);
        } else if (wasDrawer) {
            startNewRound();
        }
    });
});

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`NovaArt sunucusu aktif: http://localhost:${PORT}`);
});

// Eğer konsoldan bir komutla tetiklemek istersen sunucu terminaline şunu yazabilmen için:
process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    
    if (command === "guncelleme-basla") {
        console.log("🛠️ Güncelleme modu aktif edildi! Oyuncular kilitlendi.");
        io.emit('maintenance-start'); // Herkese sinyal gönderir
    }
    
    if (command === "guncelleme-bitir") {
        console.log("✅ Güncelleme bitti! Oyuncuların kilidi açıldı.");
        io.emit('maintenance-end'); // Ekranı kapatır
    }
});