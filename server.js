const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock'); 
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());

// Mock Database (In-Memory for prototype)
let messages = [];
let orders = {};

// 1. FRONTEND INTERFACE (HTML/JS) served directly from the server
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chat & Order Inbox</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f7f7f7; }
            .container { max-width: 800px; margin: 0 auto; display: flex; gap: 20px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .chat-box { flex: 2; display: flex; flex-direction: column; height: 500px; border: 1px solid #ddd; border-radius: 4px; }
            .messages { flex: 1; padding: 15px; overflow-y: auto; background: #fafafa; }
            .message { margin-bottom: 12px; padding: 8px 12px; border-radius: 4px; max-width: 70%; }
            .message.buyer { background: #e1f5fe; align-self: flex-start; }
            .message.seller { background: #e8f5e9; align-self: flex-end; margin-left: auto; }
            .message.system { background: #fff3e0; align-self: center; text-align: center; max-width: 90%; font-style: italic; margin: 10px auto; }
            .input-area { display: flex; padding: 10px; border-top: 1px solid #ddd; }
            .input-area input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
            .input-area button { padding: 10px 15px; background: #1dbf73; color: white; border: none; border-radius: 4px; margin-left: 5px; cursor: pointer; }
            .sidebar { flex: 1; border: 1px solid #ddd; padding: 15px; border-radius: 4px; background: #fff; }
            .btn-order { width: 100%; padding: 12px; background: #1dbf73; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; margin-top: 10px; }
            .order-box { border: 1px solid #ffb300; background: #fffde7; padding: 10px; margin-top: 15px; border-radius: 4px; text-align: center; }
        </style>
    </head>
    <body>
        <h2 style="text-align:center; color:#333;">Fiverr-Style Chat & Order</h2>
        <div class="container">
            <!-- Chat Window -->
            <div class="chat-box">
                <div class="messages" id="message-container"></div>
                <div class="input-area">
                    <input type="text" id="msg-input" placeholder="Type a message...">
                    <button onclick="sendMessage()">Send</button>
                </div>
            </div>
            
            <!-- Actions Sidebar -->
            <div class="sidebar">
                <h3>Actions</h3>
                <p>Simulate Roles:</p>
                <select id="role-select" onchange="updateRole()">
                    <option value="buyer">I am the Buyer</option>
                    <option value="seller">I am the Seller</option>
                </select>
                <hr>
                <div id="seller-tools" style="display:none;">
                    <h4>Seller Controls</h4>
                    <label>Amount ($):</label>
                    <input type="number" id="amount-input" value="50" style="width:80%; padding:5px; margin-bottom:10px;"><br>
                    <button class="btn-order" onclick="createOffer()">Send Custom Offer</button>
                </div>
                <div id="active-order-box"></div>
            </div>
        </div>

        <script>
            const socket = io();
            let currentRole = 'buyer';

            // Handle incoming messages
            socket.on('message', (msg) => {
                appendMessage(msg.text, msg.sender, msg.isSystem);
            });

            // Handle order status updates
            socket.on('orderUpdate', (order) => {
                renderOrderBox(order);
            });

            function updateRole() {
                currentRole = document.getElementById('role-select').value;
                document.getElementById('seller-tools').style.display = currentRole === 'seller' ? 'block' : 'none';
            }

            function sendMessage() {
                const input = document.getElementById('msg-input');
                if(!input.value.trim()) return;
                socket.emit('message', { text: input.value, sender: currentRole });
                input.value = '';
            }

            function appendMessage(text, sender, isSystem) {
                const container = document.getElementById('message-container');
                const div = document.createElement('div');
                div.className = 'message ' + (isSystem ? 'system' : sender);
                div.innerText = text;
                container.appendChild(div);
                container.scrollTop = container.scrollHeight;
            }

            function createOffer() {
                const amount = document.getElementById('amount-input').value;
                socket.emit('createOffer', { amount: amount });
            }

            function renderOrderBox(order) {
                const box = document.getElementById('active-order-box');
                if (!order) { box.innerHTML = ''; return; }
                
                if (order.status === 'pending') {
                    box.innerHTML = \`
                        <div class="order-box">
                            <h4>Custom Offer Created</h4>
                            <p>Amount: <strong>\$\${order.amount}</strong></p>
                            \${currentRole === 'buyer' ? \`<button class="btn-order" style="background:#ffb300;" onclick="payOrder('\${order.id}')">Pay with Card</button>\` : '<p style="color:#666; font-size:12px;">Waiting for buyer payment...</p>'}
                        </div>\`;
                } else if (order.status === 'paid') {
                    box.innerHTML = \`
                        <div class="order-box" style="border-color:#1dbf73; background:#e8f5e9;">
                            <h4 style="color:#1dbf73;">✔ Order Active</h4>
                            <p>Amount: <strong>\$\${order.amount}</strong></p>
                            <p style="color:#2e7d32; font-size:13px;">Payment secured. Seller can start working!</p>
                        </div>\`;
                }
            }

            function payOrder(orderId) {
                // Trigger backend Stripe session checkout
                fetch('/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: orderId })
                })
                .then(res => res.json())
                .then(data => {
                    if(data.url) {
                        window.location.href = data.url; // Redirects to secure Stripe Card payment screen
                    }
                });
            }
            
            updateRole();
        </script>
    </body>
    </html>
    `);
});

// 2. REAL-TIME CHAT & ORDER LOGIC
io.on('connection', (socket) => {
    // Send existing data to newly connected client
    messages.forEach(msg => socket.emit('message', msg));
    const activeOrder = Object.values(orders).find(o => o.status === 'pending' || o.status === 'paid');
    if(activeOrder) socket.emit('orderUpdate', activeOrder);

    socket.on('message', (data) => {
        const msg = { text: `${data.sender === 'buyer' ? 'Buyer' : 'Seller'}: ${data.text}`, sender: data.sender };
        messages.push(msg);
        io.emit('message', msg);
    });

    socket.on('createOffer', (data) => {
        const orderId = 'ord_' + Math.random().toString(36).substr(2, 9);
        const newOrder = { id: orderId, amount: data.amount, status: 'pending' };
        orders[orderId] = newOrder;
        
        const sysMsg = { text: `📢 Seller sent a custom offer for $${data.amount}`, sender: 'system', isSystem: true };
        messages.push(sysMsg);
        
        io.emit('message', sysMsg);
        io.emit('orderUpdate', newOrder);
    });
});

// 3. STRIPE CARD PAYMENT INTEGRATION
app.post('/create-checkout-session', async (req, require) => {
    const { orderId } = req.body;
    const order = orders[orderId];
    
    // Construct domain url based on where app is running
    const host = req.get('host');
    const protocol = req.protocol;
    const domain = `${protocol}://${host}`;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: `Custom Order #${orderId}` },
                    unit_amount: order.amount * 100, // Stripe expects amounts in cents
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${domain}/payment-success?orderId=${orderId}`,
            cancel_url: `${domain}`,
        });
        req.res.json({ url: session.url });
    } catch (e) {
        req.res.status(500).json({ error: e.message });
    }
});

// Handle successful payment redirect
app.get('/payment-success', (req, res) => {
    const { orderId } = req.query;
    if(orders[orderId]) {
        orders[orderId].status = 'paid';
        const sysMsg = { text: `🎉 Payment Confirmed! Order #${orderId} is now active.`, sender: 'system', isSystem: true };
        messages.push(sysMsg);
    }
    res.redirect('/');
});

