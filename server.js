const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANTE: Servir archivos estáticos PRIMERO
app.use(express.static(path.join(__dirname)));

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "app-uniformes-multi.html"));
});

// API - Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();
    
    if (error || !data) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }
    
    res.json({ 
      success: true, 
      user: {
        id: data.id,
        username: data.username,
        rol: data.rol
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API - Obtener pedidos
app.get("/api/pedidos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('fecha_creacion', { ascending: false });
    
    if (error) throw error;
    
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API - Crear pedido
app.post("/api/pedidos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API - Actualizar pedido
app.put("/api/pedidos/:id", async (req, res) => {
  const { id } = req.params;
  
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API - Eliminar pedido
app.delete("/api/pedidos/:id", async (req, res) => {
  const { id } = req.params;
  
  try {
    const { error } = await supabase
      .from('pedidos')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📂 Sirviendo archivos estáticos desde: ${__dirname}`);
});
