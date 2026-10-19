const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- KEYS ---
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_SECRET_KEY = 'YOUR_SUPABASE_SECRET_KEY';
const MASTER_SEED = process.env.MASTER_SEED; // We will set this in Railway next

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// --- WALLET GENERATION ---
async function generateUserWallet(userId) {
  const seed = await bip39.mnemonicToSeed(MASTER_SEED);
  let userIndex = 0;
  for (let i = 0; i < userId.length; i++) userIndex += userId.charCodeAt(i);
  const path = `m/44'/501'/${userIndex}'/0'`;
  const derivedSeed = derivePath(path, seed.toString('hex')).key;
  const keypair = Keypair.fromSeed(derivedSeed);
  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Buffer.from(keypair.secretKey).toString('hex')
  };
}

let waitingQueue = [];

io.on('connection', (socket) => {
  socket.on('get_deposit_address', async (data) => {
    const { userId } = data;
    const { data: user } = await supabase.from('users').select('sol_deposit_address, sol_private_key').eq('id', userId).single();
    
    if (user && user.sol_deposit_address) {
      socket.emit('deposit_address', user.sol_deposit_address);
    } else {
      const newWallet = await generateUserWallet(userId);
      await supabase.from('users').update({ sol_deposit_address: newWallet.publicKey, sol_private_key: newWallet.secretKey }).eq('id', userId);
      socket.emit('deposit_address', newWallet.publicKey);
    }
  });

  // ... [KEEP YOUR EXISTING JOIN_QUEUE AND GAME LOGIC HERE] ...
  // (Paste the join_queue, cashout, and startGame logic from your previous code here)

});

// --- DEPOSIT SWEEPER (Checks every 30s) ---
async function checkDepositsAndSweep() {
  const { data: users } = await supabase.from('users').select('id, sol_deposit_address, sol_private_key').not('sol_deposit_address', 'is', null);
  if (!users) return;

  for (const user of users) {
    try {
      const pubKey = new PublicKey(user.sol_deposit_address);
      const balance = await connection.getBalance(pubKey);

      if (balance > 10000000) { // > 0.01 SOL
        const amountSOL = balance / LAMPORTS_PER_SOL;
        const amountUSD = amountSOL * 150; // Example rate

        await supabase.rpc('add_balance', { user_id: user.id, amount: amountUSD });
        
        const userKeypair = Keypair.fromSecretKey(Buffer.from(user.sol_private_key, 'hex'));
        const masterSeed = await bip39.mnemonicToSeed(MASTER_SEED);
        const masterKeypair = Keypair.fromSeed(derivePath(`m/44'/501'/0'/0'`, masterSeed.toString('hex')).key);

        const transaction = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: userKeypair.publicKey, toPubkey: masterKeypair.publicKey, lamports: balance - 5000 })
        );
        await connection.sendTransaction(transaction, [userKeypair]);
        console.log(`Deposited & Swept for user ${user.id}`);
      }
    } catch (err) { console.log(err.message); }
  }
}
setInterval(checkDepositsAndSweep, 30000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Engine running on port ${PORT}`));
