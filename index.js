// server.js
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root123',
  database: process.env.DB_NAME || 'wedding_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
pool.on("connection",(stream)=>
    console.log("New connection")
)


// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  
  jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret', (err, user) => {
    if (err) return res.status(403).json({ message: 'Forbidden' });
    req.user = user;
    next();
  });
};

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(password)
    const [rows] = await pool.query('SELECT * FROM admin_users WHERE username = ?', [username]);
    
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const user = rows[0];
    // const validPassword = await bcrypt.compare(password, user.password);
    const validPassword = password === user.password
    console.log(user.password, password)
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '8h' });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all guests
app.get('/api/guests', authenticateToken, async (req, res) => {
    try {
      const { relation, side, phone } = req.query;
      let query = 'SELECT * FROM guests';
      const params = [];
      
      const conditions = [];
      
      if (relation) {
        conditions.push('relation = ?');
        params.push(relation);
      }
      
      if (side) {
        conditions.push('side = ?');
        params.push(side);
      }
      
      if (phone) {
        conditions.push('phone = ?');
        params.push(phone);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY created_at DESC';
      
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (error) {
      console.error('Error fetching guests:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });

// Add a new guest
app.post('/api/guests', authenticateToken, async (req, res) => {
  try {
    const { name, phone, relation, side, guest_count } = req.body;
    
    if (!name || !phone || !relation || !side) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    const [result] = await pool.query(
        'INSERT INTO guests (name, phone, relation, side, guest_count) VALUES (?, ?, ?, ?, ?)',
        [name, phone, relation, side, guest_count]
    );
    
    const [newGuest] = await pool.query('SELECT * FROM guests WHERE id = ?', [result.insertId]);
    res.status(201).json(newGuest[0]);
  } catch (error) {
    console.error('Error adding guest:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update guest invitation status
app.patch('/api/guests/:id/invite', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_invited } = req.body;
    
    await pool.query('UPDATE guests SET is_invited = ? WHERE id = ?', [is_invited, id]);
    
    const [updated] = await pool.query('SELECT * FROM guests WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating invitation status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update guest attendance status
// Update guest attendance status and count
app.patch('/api/guests/:id/attendance', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { is_attending, guest_count } = req.body;
      
      let query = 'UPDATE guests SET';
      const params = [];
      
      // Check which fields to update
      if (is_attending !== undefined) {
        query += ' is_attending = ?';
        params.push(is_attending);
      }
      
      if (guest_count !== undefined) {
        // If we've already added is_attending, we need a comma
        if (params.length > 0) {
          query += ',';
        }
        query += ' guest_count = ?';
        params.push(guest_count);
      }
      
      // Add the WHERE clause
      query += ' WHERE id = ?';
      params.push(id);
      
      // Only proceed if we have something to update
      if (params.length > 1) {
        await pool.query(query, params);
        
        const [updated] = await pool.query('SELECT * FROM guests WHERE id = ?', [id]);
        res.json(updated[0]);
      } else {
        res.status(400).json({ message: 'No fields to update provided' });
      }
    } catch (error) {
      console.error('Error updating attendance status:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });

// Get statistics
// Get statistics
app.get('/api/statistics', authenticateToken, async (req, res) => {
    try {
      const [totalGuests] = await pool.query('SELECT COUNT(*) as count FROM guests');
      const [brideGuests] = await pool.query('SELECT COUNT(*) as count FROM guests WHERE side = "bride"');
      const [groomGuests] = await pool.query('SELECT COUNT(*) as count FROM guests WHERE side = "groom"');
      const [invitedGuests] = await pool.query('SELECT COUNT(*) as count FROM guests WHERE is_invited = TRUE');
      const [attendingGuests] = await pool.query('SELECT COUNT(*) as count FROM guests WHERE is_attending = TRUE');
      
      // Get total number of people attending (sum of guest_count for attending guests)
      const [totalAttendingCount] = await pool.query(`
        SELECT SUM(guest_count) as count 
        FROM guests 
        WHERE is_attending = TRUE
      `);
      
      const [relationCounts] = await pool.query(`
        SELECT relation, COUNT(*) as count
        FROM guests
        GROUP BY relation
        ORDER BY count DESC
      `);
      
      res.json({
        total: totalGuests[0].count,
        bride: brideGuests[0].count,
        groom: groomGuests[0].count,
        invited: invitedGuests[0].count,
        attending: attendingGuests[0].count,
        totalAttendingCount: totalAttendingCount[0].count || 0,
        relationBreakdown: relationCounts
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });

// Delete a guest
app.delete('/api/guests/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM guests WHERE id = ?', [id]);
    res.json({ message: 'Guest deleted successfully' });
  } catch (error) {
    console.error('Error deleting guest:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});