FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir waitress flask pymcprotocol

COPY app.py /app/app.py

EXPOSE 8770

CMD ["python", "app.py"]
