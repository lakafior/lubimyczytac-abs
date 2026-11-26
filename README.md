Improvements over the original version:
- additional sources for book cover
- books without ISBN get a similarity penalty
- error 429 (throttling) is handled
- for books that have similarity >=0,95 and don't have ISBN, fake ISBN=0 is added (option useful when combined with "Skip matching books that already have an ISBN" option in ABS)


# lubimyczytac-abs
Audiobookshelf Custom Metadata Provider for https://lubimyczytac.pl
Docker hub page: https://hub.docker.com/r/lakafior/lubimyczytac-abs

## Screenshots

### List of matches
![obraz](https://github.com/user-attachments/assets/f18d64fe-2849-4669-92b9-b2471f6a9a29)

### View of matched data
![obraz](https://github.com/user-attachments/assets/425ae529-3ab2-4e64-a998-0de8861b40ec)

## Fetching features:
- Cover
- Title
- Original title (informational; omitted for Polish-original books)
- Author
- Description (without html blocks)
- Publisher
- Publish Year
- Series
- Series number
- Genres
- Tags
- Language
- ISBN
- Rectangle covers for audiobooks (if type: audiobook exsist for item)

# Instructions

## How to run

### Prerequisites:
Docker and Docker Compose installed on your system

### Setup and Running:
1. Create or copy from girhub a compose.yml file in your desired directory with the following content.
```
---
services:
  lubimyczytac-abs:
    image: lakafior/lubimyczytac-abs:latest
    container_name: lubimyczytac-abs
    restart: unless-stopped
    ports:
      - "3000:3000"
```
2. Pull the latest Docker image:
```
docker-compose pull
```
3. Start the application:
```
docker-compose up -d
```

## How to use
1. Navigate to your AudiobookShelf settings
2. Navigate to Item Metadata Utils
3. Navigate to Custom Metadata Providers
4. Click on Add
5. Name: whatever for example LubimyCzytac
6. URL: http://your-ip:3000 or hostname, eg http://lubimyczytac-abs:3000 without trailing slash
8. Authorization Header Value: whatever, but not blank, for example 00000
9. Save
