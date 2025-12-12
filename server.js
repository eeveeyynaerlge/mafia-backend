// server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: {
        origin: "*", // Allows cross-origin requests from your frontend hosted elsewhere
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

let players = {};
// Define roles that match the player count
let gameRoles = ['Mafia', 'Detective', 'Doctor', 'Townsperson', 'Townsperson', 'Townsperson']; 
let gameState = 'waiting';
let votes = {};

io.on('connection', socket => {
    console.log('A user connected:', socket.id);
    players[socket.id] = { id: socket.id, name: `Player_${socket.id.substring(0, 4)}`, role: 'unassigned', alive: true };
    io.emit('update-players', Object.values(players));
    socket.emit('chat-message', { name: 'Game Master', message: 'Welcome! Waiting for more players...' });

    socket.on('chat-message', (msg) => {
        io.emit('chat-message', { name: players[socket.id].name, message: msg });
    });

    socket.on('start-game', () => {
        const playerCount = Object.keys(players).length;
        if (playerCount >= 4 && gameState === 'waiting') {
            assignRoles(playerCount);
            gameState = 'day';
            io.emit('game-started');
            io.emit('chat-message', { name: 'Game Master', message: 'The game has started. It is Day 1. Discuss and vote!' });
            // Send personalized role info to each player
            for (const id in players) {
                io.to(id).emit('role-assigned', players[id].role);
            }
        } else if (playerCount < 4) {
            socket.emit('chat-message', { name: 'Game Master', message: 'Need at least 4 players to start.' });
        }
    });

    socket.on('submit-vote', (targetId) => {
        if (gameState === 'day' && players[socket.id].alive) {
            votes[socket.id] = targetId;
            const uniqueVotes = Object.keys(votes).length;
            const alivePlayers = Object.values(players).filter(p => p.alive).length;
            
            // Simple logic: if everyone alive voted, count votes (needs a robust timer in a real game)
            if (uniqueVotes === alivePlayers) {
                countVotesAndEndDay();
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
        io.emit('update-players', Object.values(players));
    });
});

function assignRoles(playerCount) {
    // Select the first N roles matching the player count
    const selectedRoles = gameRoles.slice(0, playerCount);
    const shuffledRoles = selectedRoles.sort(() => 0.5 - Math.random());
    let i = 0;
    for (const id in players) {
        players[id].role = shuffledRoles[i++];
    }
}

function countVotesAndEndDay() {
    // Complex logic needed here to count votes, find the lynched player, update 'alive' status, and check win conditions.
    io.emit('chat-message', { name: 'Game Master', message: 'All votes are in. Someone has been lynched (logic TBD). Starting Night Phase (TBD).' });
    votes = {};
    // Transition to night phase logic (requires more code)
}

server.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
