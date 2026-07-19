FROM python:3.11-slim

WORKDIR /app

# snap7 precisa da lib nativa do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsnap7-1 libsnap7-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir waitress flask python-snap7

COPY app.py /app/app.py

EXPOSE 8766

CMD ["python", "app.py"]
