FROM python:3.11-slim

WORKDIR /app

# Copia a lib FOCAS Linux x64 e renomeia
COPY libfwlib32.so /app/libfwlib32.so

# Instala dependências Python
RUN pip install --no-cache-dir waitress flask

# Copia o servidor
COPY app.py /app/app.py

EXPOSE 8765

CMD ["python", "app.py"]
