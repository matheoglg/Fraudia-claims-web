# ==========================================
# Etapa 1: Compilar el Frontend de React
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copiar archivos de gestión de paquetes del frontend
COPY frontend/package.json frontend/pnpm-lock.yaml* ./

# Instalar pnpm e instalar las dependencias de React
RUN npm install -g pnpm && pnpm install

# Copiar todo el código fuente del frontend
COPY frontend/ ./

# Compilar React (Vite generará la carpeta dist)
RUN pnpm build

# ==========================================
# Etapa 2: Construir el Backend en Python y Unificar
# ==========================================
FROM python:3.11-slim
WORKDIR /app

# Instalar dependencias del sistema esenciales para fpdf2, SQLite, etc.
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copiar backend requirements e instalar dependencias de Python
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copiar las carpetas del proyecto manteniendo tu estructura intacta
COPY backend/ ./backend/
COPY data/ ./data/
COPY docs/ ./docs/

# LA MAGIA EXTRAVIADA: Copiar el React compilado de la Etapa 1 al lugar que app.py espera
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Exponer el puerto estándar de Flask para el contenedor
EXPOSE 5000

# Variables de entorno esenciales para producción
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1

# ARRANQUE CORRECTO: Usamos Gunicorn en el puerto 5000 moviéndonos a la carpeta backend
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--chdir", "backend", "app:create_app()"]