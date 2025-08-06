import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState({
    tokenSet: false,
    lastSyncTime: null,
    isProcessing: false
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Obtener estado actual al cargar
  useEffect(() => {
    fetchStatus();
    // Actualizar estado cada 30 segundos
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Función para obtener el estado actual
  const fetchStatus = async () => {
    try {
      const response = await axios.get('/api/status');
      setStatus(response.data);
    } catch (err) {
      console.error('Error obteniendo estado:', err);
    }
  };

  // Función para guardar el token
  const handleSaveToken = async (e) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Por favor ingrese un token válido');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await axios.post('/api/set-token', { token });
      setMessage('Token guardado correctamente');
      setToken('');
      fetchStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'Error al guardar el token');
    } finally {
      setLoading(false);
    }
  };

  // Función para iniciar sincronización manual
  const handleSync = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await axios.post('/api/sync');
      setMessage(`Sincronización completada: ${response.data.processed} facturas procesadas, ${response.data.errors} errores`);
      fetchStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'Error al sincronizar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Integración Loyverse - SRI Ecuador</h1>
      </header>
      
      <main>
        <section className="token-section">
          <h2>Configuración de Token de Loyverse</h2>
          <form onSubmit={handleSaveToken}>
            <div className="form-group">
              <label htmlFor="token">Token de API de Loyverse:</label>
              <input
                type="text"
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Ingrese su token de Loyverse"
                className="form-control"
              />
            </div>
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Guardando...' : 'Guardar Token'}
            </button>
          </form>
        </section>

        <section className="status-section">
          <h2>Estado de la Integración</h2>
          <div className="status-info">
            <p><strong>Estado del Token:</strong> {status.tokenSet ? 'Configurado' : 'No configurado'}</p>
            <p><strong>Última Sincronización:</strong> {status.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString() : 'Nunca'}</p>
            <p><strong>Estado:</strong> {status.isProcessing ? 'Sincronizando...' : 'Inactivo'}</p>
          </div>

          <button 
            onClick={handleSync} 
            className="btn btn-success"
            disabled={loading || !status.tokenSet || status.isProcessing}
          >
            {loading ? 'Sincronizando...' : 'Sincronizar Ahora'}
          </button>
        </section>

        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-danger">{error}</div>}

        <section className="info-section">
          <h2>Información</h2>
          <p>Esta aplicación sincroniza automáticamente las facturas de Loyverse con el SRI de Ecuador cada 15 minutos.</p>
          <p>Para comenzar, ingrese su token de API de Loyverse en el formulario de arriba.</p>
          <p>Puede obtener su token de API en el Back Office de Loyverse, en la sección "Access Tokens".</p>
        </section>
      </main>

      <footer>
        <p>&copy; {new Date().getFullYear()} Integración Loyverse - SRI</p>
      </footer>
    </div>
  );
}

export default App;
