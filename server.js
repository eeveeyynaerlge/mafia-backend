// server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Centralized game state management
const rooms = new Map();

io.on('connection', socket => {
    console.log('A user connected:', socket.id);

    // --- Lobby Management ---
    socket.on('create-room', (settings) => {
        const roomId = Math.random().toString(36).substring(2, 9); // Simple unique ID
        rooms.set(roomId, {
            id: roomId,
            players: {},
            gameState: 'waiting', // waiting, day, night
            roles: ['Mafia', 'Detective', 'Doctor', 'Townsperson', 'Townsperson', 'Townsperson'],
            mafiaList: [],
            doctorProtectedId: null, // Track who doctor protected last night
            lastProtectedId: null, // Doctor can't protect the same player twice
            nightActions: { mafiaKill: null, doctorSave: null, detectiveCheck: null },
            votes: {},
        });
        socket.join(roomId);
        rooms.get(roomId).players[socket.id] = { id: socket.id, name: `Host_${socket.id.substring(0, 4)}`, alive: true };
        socket.emit('room-created', roomId);
        io.to(roomId).emit('update-players', Object.values(rooms.get(roomId).players));
    });

    socket.on('join-room', (roomId) => {
        if (rooms.has(roomId)) {
            socket.join(roomId);
            rooms.get(roomId).players[socket.id] = { id: socket.id, name: `Player_${socket.id.substring(0, 4)}`, alive: true };
            socket.emit('joined-room', roomId);
            io.to(roomId).emit('update-players', Object.values(rooms.get(roomId).players));
        } else {
            socket.emit('error', 'Room not found');
        }
    });

    // --- In-Game Communication ---
    socket.on('chat-message', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            io.to(data.roomId).emit('chat-message', { name: room.players[socket.id].name, message: data.message });
        }
    });

    socket.on('mafia-chat-message', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.players[socket.id].role === 'Mafia') {
            // Only emit to sockets who are Mafia (needs robust filtering or separate room for mafia team)
            io.to(data.roomId).emit('chat-message', { name: `[MAFIA TEAM CHAT] ${room.players[socket.id].name}`, message: data.message });
        } else {
            socket.emit('error', 'You are not in the mafia or game not found.');
        }
    });

    // --- Game Flow and Roles ---
    socket.on('start-game', (roomId) => {
        const room = rooms.get(roomId);
        if (room && Object.keys(room.players).length >= 4 && room.gameState === 'waiting') {
            assignRoles(room);
            room.gameState = 'day';
            io.to(roomId).emit('game-started');
            io.to(roomId).emit('chat-message', { name: 'GM', message: 'The game has started. It is Day 1. Discuss and vote!' });
            setTimeout(() => startNight(roomId), 30000); // 30 second day for testing
        }
    });

    socket.on('submit-vote', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.gameState === 'day' && room.players[socket.id].alive) {
            room.votes[socket.id] = data.targetId;
            // Count votes logic to end day goes here (requires more code)
            io.to(data.roomId).emit('chat-message', { name: 'GM', message: `${room.players[socket.id].name} has voted.` });
        }
    });

    // Night Actions
    socket.on('night-action', (data) => {
        const room = rooms.get(data.roomId);
        const player = room.players[socket.id];
        if (room && room.gameState === 'night' && player.alive) {
            if (player.role === 'Mafia') room.nightActions.mafiaKill = data.targetId;
            if (player.role === 'Doctor') {
                if (data.targetId !== room.lastProtectedId) { // Doctor can't protect same person twice
                    room.nightActions.doctorSave = data.targetId;
                    room.lastProtectedId = data.targetId;
                } else {
                    socket.emit('error', 'You protected this person last night. Choose someone else.');
                }
            }
            if (player.role === 'Detective') {
                room.nightActions.detectiveCheck = data.targetId;
                // Send result back only to the detective immediately
                const targetRole = room.players[data.targetId].role;
                socket.emit('detective-result', `Player ${room.players[data.targetId].name} is a ${targetRole === 'Mafia' ? 'Mafia' : 'Townsperson'}.`);
            }
            // Check if all actions are in to end night early (or wait for timer)
        }
    });

    socket.on('disconnect', () => {
        // Handle player disconnects from rooms (more complex logic needed)
        console.log('User disconnected:', socket.id);
    });
});

function assignRoles(room) {
    const selectedRoles = room.roles.slice(0, Object.keys(room.players).length);
    const shuffledRoles = selectedRoles.sort(() => 0.5 - Math.random());
    let i = 0;
    for (const id in room.players) {
        room.players[id].role = shuffledRoles[i++];
        if (room.players[id].role === 'Mafia') {
            room.mafiaList.push(id);
        }
    }
}

function startNight(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.gameState = 'night';
    io.to(roomId).emit('chat-message', { name: 'GM', message: 'It is now NIGHT. All town members sleep. Doctor, Detective, and Mafia submit their actions.' });
    // Inform Mafia of each other
    room.mafiaList.forEach(mafiaId => {
        const teammates = room.mafiaList.filter(id => id !== mafiaId).map(id => room.players[id].name).join(', ');
        io.to(mafiaId).emit('chat-message', { name: 'GM', message: `Your mafia teammates are: ${teammates}` });
    });
    
    // Set night timer
    setTimeout(() => endNight(roomId), 30000); // 30 second night for testing
}

function endNight(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.gameState = 'day';
    // Process night actions (mafia kill, doctor save)
    const killedPlayerId = room.nightActions.mafiaKill;
    const savedPlayerId = room.nightActions.doctorSave;

    if (killedPlayerId && killedPlayerId !== savedPlayerId) {
        room.players[killedPlayerId].alive = false;
        io.to(roomId).emit('chat-message', { name: 'GM', message: `Player ${room.players[killedPlayerId].name} was found dead this morning. They were a ${room.players[killedPlayerId].role}.` });
    } else if (killedPlayerId === savedPlayerId) {
        io.to(roomId).emit('chat-message', { name: 'GM', message: `Someone was attacked last night, but a mysterious force saved them! No one died.` });
    } else {
         io.to(roomId).emit('chat-message', { name: 'GM', message: `There was no kill last night. Everyone is safe.` });
    }
    
    // Reset actions and votes for new day
    room.nightActions = { mafiaKill: null, doctorSave: null, detectiveCheck: null };
    room.votes = {};
    io.to(roomId).emit('update-players', Object.values(room.players)); // Update player status (alive/dead)

    // Check win conditions (not implemented in this basic example)
    io.to(roomId).emit('chat-message', { name: 'GM', message: 'It is now DAY. Discuss and vote.' });
    setTimeout(() => startNight(roomId), 30000); // Start next night
}

server.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
