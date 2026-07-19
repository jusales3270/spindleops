FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir waitress flask pyLSV2

COPY app.py /app/app.py

EXPOSE 8768

CMD ["python", "app.py"]
