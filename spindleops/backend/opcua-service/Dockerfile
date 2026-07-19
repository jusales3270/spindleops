FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir waitress flask asyncua

COPY app.py /app/app.py

EXPOSE 8772

CMD ["python", "app.py"]
