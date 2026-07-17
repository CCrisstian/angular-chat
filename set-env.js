const fs = require('fs');

// Configuración de la ruta donde Angular esperará encontrar el archivo
const targetPath = `./src/environments/environment.ts`;
const targetPathDev = `./src/environments/environment.development.ts`;

// Obtenemos la URL del backend desde las variables del sistema (o usamos localhost si no existe)
const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

// Estructura del archivo environment.ts que vamos a crear dinámicamente
const envConfigFile = `export const environment = {
  production: ${process.env.NODE_ENV === 'production'},
  backendUrl: '${backendUrl}'
};
`;

// Creamos la carpeta src/environments si no existe
if (!fs.existsSync('./src/environments')) {
  fs.mkdirSync('./src/environments', { recursive: true });
}

// Escribimos el contenido en los archivos de entorno
fs.writeFileSync(targetPath, envConfigFile);
fs.writeFileSync(targetPathDev, envConfigFile);

console.log(`✅ Archivos de entorno generados con éxito apuntando a: ${backendUrl}`);