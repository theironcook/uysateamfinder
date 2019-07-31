const axios = require('axios');
const htmlParser = require('htmlparser2');
const moment = require('moment');
const _ = require('lodash');
const fs = require('fs');

let currentDivision;
const divisions = {};
const games = [];
const teams = {};
const clubNames = {};
const venues = {};

let currentClubGuid;
let currentVenue;

const DivisionsParser = function(){

  let inDivisionTR = false;  
  let inDivisionTDCount = 0;
  let inDivisionTDName = false;
  let inDivisionTDBracketLink = false;

  this.parser = new htmlParser.Parser({
  onopentag: function(name, attributes){    
    switch(name){
      case 'tr':        
        if(attributes.class === 'report0' || attributes.class === 'report1'){
          inDivisionTR = true;
        }
        break;

      case 'td':
        if(inDivisionTR){
          inDivisionTDCount++;

          switch(inDivisionTDCount){
            case 1:
              inDivisionTDName = true;
              break;
            case 2:
              inDivisionTDBracketLink = true;
              break;
            case 3:
              inDivisionTDScheduleLink = true;              
              break;
          }

        }
        break;
    }

    if(name === 'a'){
      if(inDivisionTDBracketLink){      
        divisions[currentDivision] = {bracketsLink: attributes.href, teams: []};
      }
      else if (inDivisionTDScheduleLink){      
        divisions[currentDivision].scheduleLink = attributes.href;  
      }
    }
  },

  ontext: function(text){
    if(inDivisionTDName){
      currentDivision = text;
    }
  },
  
  onclosetag: function(name){
    switch(name){      
      case 'tr':        
        inDivisionTR = false;          
        inDivisionTDCount = 0;        
        break;

      case 'td':
        inDivisionTDName = inDivisionTDBracketLink = inDivisionTDScheduleLink = false;        
    }
  }
}, {decodeEntities: true});
};

const BracketsParser = function(){ 

  let inDivisionTR;
  let teamKey;
  let currentTeam;

  this.parser = new htmlParser.Parser({
    onopentag: function(name, attributes){      
      switch(name){
        case 'tr':
            if(attributes.class === 'report0' || attributes.class === 'report1'){
              inDivisionTR = true;
            }
          break;

        case 'td':
          if(inDivisionTR){
            inDivisionTDCount++;

            switch(inDivisionTDCount){
              case 2:
                teamKey = 'name';
                break;
              case 3:
                teamKey = 'city';           
                break;            
              case 4:
                teamKey = 'teamID';              
                break;
              case 5:
                teamKey = 'coach';
                break;
            }

          }
          break;          
      }
    },

    ontext: function(text){
      if(teamKey && text && text.trim()){
        if(!currentTeam){
          currentTeam = {};
        }

        if(teamKey === 'name'){
          text = text.replace('\'', '');
        }

        currentTeam[teamKey] = text;
      }
    },
    
    onclosetag: function(name){
      switch(name){      
        case 'tr':          
          inDivisionTR = false;          
          inDivisionTDCount = 0;   
          
          if(currentTeam){                        
            divisions[currentDivision].teams.push(currentTeam);
            currentTeam = null;
          }
          
          break;
  
        case 'td':
          teamKey = null;
          break;
      }
    }
  }, {decodeEntities: true});
};


const GamesAndTeamsParser = function(){
  let currentTagName;

  let inSummary = false;
  let summaryColCount;
  let summaryRowCount = 0;

  let currentTeamClubLink;

  let currentDate;
  let currentDateRowCount;
  let currentDateColCount;
  let currentGame;

  this.parser = new htmlParser.Parser({
    onopentag: function(name, attributes){
      currentTagName = name; 
      switch(name){
        case 'tr':
          if(currentDate){
            currentDateRowCount++;
            currentDateColCount = 0;
            currentGame = {date: currentDate.format('M/D/YY')};
          }

          if(inSummary){
            summaryColCount = 0;
            summaryRowCount++;
          }
          break;

        case 'td':
          if(inSummary){
            summaryColCount++;
          }

          if(currentDate && currentDateRowCount > 1){
            currentDateColCount++;

            switch(currentDateColCount){
              case 2:
                if(attributes.onclick){
                  currentGame.venueLink = attributes.onclick.match(/window.open\('([^']+)/)[1];
                  currentGame.venueLink = currentGame.venueLink.replace('info/../', '').replace(/&amp;/g, '&');
                }
                break;
            }
          }

          break;   
          
        case 'a':
          if(inSummary){
            switch(summaryColCount){
              case 1:
                currentTeamClubLink = attributes.href.replace(/&amp;/g, '&').replace('\r\n', '').trim();
                break;
            }

          }
          break;
      }
    },

    ontext: function(text){
      if(inSummary){
        if(summaryColCount == 2 && text.length > 4){
          const teamName = text.substring(text.indexOf(':')+1).trim();
          teams[teamName] = { name: teamName, 
                              clubLink: currentTeamClubLink, 
                              division: currentDivision, 
                              rank: summaryRowCount, 
                              stats: {
                                homeVenueCounts: {}, 
                                gameCount: 0, 
                                winCount: 0, 
                                lossCount: 0, 
                                tieCount: 0, 
                                goalsFor: 0, 
                                goalsAgainst: 0,
                                timeline: {}
                              }};
          console.log('Processing team ', teamName);
        }
      }

      switch(currentTagName){
        case 'b':
          if(text.trim() === 'Points Detail'){
            inSummary = true;
          }
          else if(text.includes('Bracket&nbsp;-&nbsp;')){
            const dateString = text.replace('Bracket&nbsp;-&nbsp;', '').trim().replace(/[^,]+,\s+/, '');            
            currentDate = moment(dateString, 'MMMM DD, YYYY');            
            currentDateRowCount = currentDateColCount = 0;
          }

          break;

        case 'td':
          switch(currentDateColCount){
            case 2:
              if(currentGame.venueLink){
                currentGame.venueName = text.replace(/&nbsp;/g, '').trim();
              }
              break;

            case 6:
              currentGame.homeTeamName = text.replace(/&nbsp;/g, '').trim();
              break;

            case 7:
              currentGame.homeTeamScore = _.parseInt(text.replace(/&nbsp;/g, '').trim());
              break;
            
            case 9:
              currentGame.awayTeamName = text.replace(/&nbsp;/g, '').trim();
              break;
  
            case 10:
              currentGame.awayTeamScore = _.parseInt(text.replace(/&nbsp;/g, '').trim());
              games.push(currentGame);
              break;
          }

          break;

        case 'font':
          switch(currentDateColCount){
            case 7:
              // stupid color coding for red cards
              if(! isNaN(text)){
                currentGame.homeTeamScore = _.parseInt(text.replace(/&nbsp;/g, '').trim());
              }
              
              break;
                
            case 10:
              if(! isNaN(text)){
                currentGame.awayTeamScore = _.parseInt(text.replace(/&nbsp;/g, '').trim());
                games.push(currentGame);
              }
              break;
          }
          break;
      }
    },

    onclosetag: function(name){
      switch(name){
        case 'table':
          inSummary = false;
          break;
      }
    }
  }, {decodeEntities: false});
};


const ClubsParser = function(){

  let isInClubTitle;

  this.parser = new htmlParser.Parser({
  onopentag: function(name, attributes){    
    if(name === 'span' && attributes.class === 'title'){
      isInClubTitle = true;
    }
  },

  ontext: function(text){
    if(isInClubTitle){
      const clubName = text.replace('Standings', '').trim();
      clubNames[currentClubGuid] = clubName;
      console.log('Processed club', clubName);
    }
  },

  onclosetag: function(name){
     isInClubTitle = false;
  }
}, {decodeEntities: true});
};


const VenuesParser = function(){

  let currentTagName;
  let nextTDAddressCount = 0;  
  
  this.parser = new htmlParser.Parser({
  onopentag: function(name, attributes){    
    currentTagName = name;
  },

  ontext: function(text){
    if(nextTDAddressCount > 0){
      if(text.trim() !== ''){
        currentVenue.address += text.replace(/\r\n\t/g, '');
      }
    }

    switch(currentTagName){
      case 'b':
        if(text === 'Address:'){
          nextTDAddressCount = 2;
        }
        break;
    }
  },

  onclosetag: function(name){
    switch(name){
      case 'td':
        nextTDAddressCount--;
        break;
    }  
  }
}, {decodeEntities: true});
};


(async () => {
  const baseUrl = 'https://uysa.affinitysoccer.com/tour/public/info/';

  // First get all of the divisions  
  (new DivisionsParser()).parser.write((await axios.get(`${baseUrl}accepted_list.asp?sessionguid=&tournamentguid=1DD3F27D-E5C2-4B2F-9A2C-7572C0EB52B8`)).data);
  (new DivisionsParser()).parser.write((await axios.get(`${baseUrl}accepted_list.asp?sessionguid=&Tournamentguid={2B799269-34D5-4760-AD9C-2EBDDA295000}`)).data);  

  // Next get the bracket data and the schedule data
  const divisionNames = Object.keys(divisions);
  
  for(let i = 0; i < divisionNames.length; i++){
    currentDivision = divisionNames[i];
    
    (new BracketsParser()).parser.write((await axios.get(`${baseUrl}${divisions[currentDivision].bracketsLink}`)).data);
    (new GamesAndTeamsParser()).parser.write((await axios.get(`${baseUrl}${divisions[currentDivision].scheduleLink}`)).data);
    console.log('Processing division: ', divisionNames[i]);
  }

  // Move the bracket team info to the team objects
  for(let i = 0; i < divisionNames.length; i++){
    const division = divisions[divisionNames[i]];    

    for(let j = 0; j < division.teams.length; j++){
      const divTeam = division.teams[j];      

      console.log('divTeam.name is ', divTeam.name, teams[divTeam.name] ? 'YES' : 'NO');
      
      teams[divTeam.name]['city'] = divTeam.city;
      teams[divTeam.name]['teamID'] = divTeam.teamID;
      teams[divTeam.name]['coach'] = divTeam.coach;
    }
  }

  // I don't want the teams in the divisions json
  for(let i = 0; i < divisionNames.length; i++){
    const division = divisions[divisionNames[i]];    
    delete division.teams;
  }

  // Find all club names across all teams
  const teamNames = Object.keys(teams);
  for(let i = 0; i < teamNames.length; i++){
    const team = teams[teamNames[i]];
    team.clubGuid = team.clubLink.match(/.*clubguid=([^&]+)/)[1];

    if(!clubNames[team.clubGuid]){
      currentClubGuid = team.clubGuid;
      (new ClubsParser()).parser.write((await axios.get(`${baseUrl}${team.clubLink}`)).data);
    }
  }

  // Link the club name with the teams
  for(let i = 0; i < teamNames.length; i++){
    const team = teams[teamNames[i]];
    team.clubName = clubNames[team.clubGuid];
  }

  // aggregate all unique venues across all games - slow and I already did this
  /*
  for(let i = 0; i < games.length; i++){
    const game = games[i];

    if(!venues[game.venueName]){
      currentVenue = {name: game.venueName, address: ''};
      console.log('Processing venue ', currentVenue.name);
      venues[currentVenue.name] = currentVenue;
      try {
        (new VenuesParser()).parser.write((await axios.get(`${baseUrl}${game.venueLink}`)).data);
      }
      catch(err){
        console.error(`Error processing venue: ${currentVenue.name} link: ${game.venueLink} game: ${JSON.stringify(game)}`, err);
      }
    }
  }*/

  console.log('Processing stats');

  // aggregate all of the game stats
  for(let i = 0; i < games.length; i++){
    const game = games[i];

    try {
      const homeTeam = teams[game.homeTeamName];
      const awayTeam = teams[game.awayTeamName];

      if(!homeTeam.stats.homeVenueCounts[game.venueName]){
        homeTeam.stats.homeVenueCounts[game.venueName] = 1;
      }
      else {
        homeTeam.stats.homeVenueCounts[game.venueName]++;
      }

      homeTeam.stats.gameCount++;
      awayTeam.stats.gameCount++;

      homeTeam.stats.goalsFor += game.homeTeamScore;
      homeTeam.stats.goalsAgainst += game.awayTeamScore;
      
      awayTeam.stats.goalsFor += game.awayTeamScore;
      awayTeam.stats.goalsAgainst += game.homeTeamScore;
      
      if(game.homeTeamScore === game.awayTeamScore){
        homeTeam.stats.tieCount++;
        awayTeam.stats.tieCount++;
      }
      else if(game.homeTeamScore > game.awayTeamScore){
        homeTeam.stats.winCount++;
        awayTeam.stats.lossCount++;
      }
      else {
        homeTeam.stats.lossCount++;
        awayTeam.stats.winCount++;
      }

      homeTeam.stats.timeline[game.date] = {
        winStat: game.homeTeamScore === game.awayTeamScore ? 1 : (game.homeTeamScore > game.awayTeamScore ? 2 : 0),
        goalsFor: game.homeTeamScore,
        goalsAgainst: game.awayTeamScore,
        opponentName: game.awayTeamName,
        isHome: true,
        venueName: game.venueName
      };

      awayTeam.stats.timeline[game.date] = {
        winStat: game.homeTeamScore === game.awayTeamScore ? 1 :(game.awayTeamScore > game.homeTeamScore ? 2 : 0),
        goalsFor: game.awayTeamScore,
        goalsAgainst: game.homeTeamScore,
        opponentName: game.homeTeamName,
        isHome: false,
        venueName: game.venueName
      };
    }
    catch(err){
      console.error(`Error processing game: ${JSON.stringify(game)}`, err);
    }
  }
  
  fs.writeFileSync('teams.json', JSON.stringify(teams));
  fs.writeFileSync('divisions.json', JSON.stringify(divisions));
  //fs.writeFileSync('venues.json', JSON.stringify(venues));
  
 
  console.log('done');
})();

 
