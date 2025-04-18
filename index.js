// server.js
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require("./db")
const app = express();
app.use(cors());
app.use(express.json());
const { MessagingResponse } = require('twilio').twiml;


// Database connection


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
    
    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '5d' });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all guests
app.get('/api/guests',authenticateToken, async (req, res) => {
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
    
    // Check if a guest with this phone number already exists
    const [existingGuest] = await pool.query('SELECT * FROM guests WHERE phone = ?', [phone]);
    
    if (existingGuest.length > 0) {
      return res.status(409).json({ 
        message: 'A guest with this phone number already exists',
        existingGuest: existingGuest[0]
      });
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
app.patch('/api/guests/:phone/attendance', async (req, res) => {
  try {
    const { phone } = req.params;
    const { is_attending, attending_guest_count } = req.body;
    
    // First, check if the guest exists and is invited
    const [guest] = await pool.query('SELECT * FROM guests WHERE phone = ?', [phone]);
    
    if (guest.length === 0) {
      return res.status(404).json({ message: 'Guest not found' });
    }
    
    if (!guest[0].is_invited) {
      return res.status(403).json({ 
        message: 'Cannot update attendance for uninvited guest',
        is_invited: false
      });
    }
    
    // Continue with the update if the guest is invited
    let query = 'UPDATE guests SET';
    const params = [];
    const setStatements = [];

    if (is_attending !== undefined) {
      setStatements.push(' is_attending = ?');
      params.push(is_attending);
    }

    if (attending_guest_count !== undefined) {
      setStatements.push(' attending_guest_count = ?');
      params.push(attending_guest_count);
    }

    // Always mark has_responded true when this route is hit
    setStatements.push(' has_responded = TRUE');

    // Final query
    query += setStatements.join(',');
    query += ' WHERE phone = ?';
    params.push(phone);

    await pool.query(query, params);

    const [updated] = await pool.query('SELECT * FROM guests WHERE phone = ?', [phone]);
    res.json(updated[0]);
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
        SELECT SUM(attending_guest_count) as count 
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


//twilio
app.post('/sms', (req, res) => {
  const twiml = new MessagingResponse();

  twiml.message('The Robots are coming! Head for the hills!');

  res.type('text/xml').send(twiml.toString());
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

