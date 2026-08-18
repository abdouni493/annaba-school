fix the interface of planner page make change the name of create new seance to create new emploi du temps and the same for the name of the emploi du temps on the interface of create emploi du temps
and fix the interface of create new emploi du temps add for it new option user can set the number of seances on the month and the total price for the month and make it calculate the price per seance automatically 
then let user set how much the school will get money from this total price of the month and make it calculate the rest , that reset for the teacher payment make it divided by the number of the seances  that wil display the seance price that will get pay the teacher from this empoloi du temps and make sure to make this new informations display on the interface of teacher view details interface and make sure to make this new options on the creation of emploi du temps displaying on the interface of view details button action of that created emploi

fix the creation of the students create new option when user select each emploi du temps then let user set how much the student payed for this emploi du temps as sold for that emploi du temps 
and make sure to do the same for all the rest selected emplois du temps make user set how much have payed as give a sold for that emploi du temps and make it when user create the student then ask him for print the bon dinscriptions that will display the personal informations of that student and the groupes that subscribed on them and the sold payed for each emploi du temps 
make sure to make this new informations of payement on the creation of the students dispaly on the interface of students view details button action 

fix the interface of students remove the buttons actions of inscriptions and remove the button action of renouvelement of subscription replace them with one button action for pay and recharge the emploi du temps solds make sure to make it display the current subscribed emploi du temps of that student and the current sold rest negative or positive with make option for filtering by the monthes m1 and m2 ... and make sure to make it display alert for the debt or sold 0 or soon to expire 
thenont he same interface make option of create new sold for each emploi du temps with askhim for print the payement 

fix the interface of students change the design of the card of students make it display the presonal informations and number of creation make it statiing onthe cretion of students form 00001 
and let user can seach about that student with that number 
make the card display all the subscripitons emploi du temps of that student and remove the number of presences and remove the restes seances and make it display only the total of debts with alert with make user can click on it to see the details on the interface create view details of student 

fix the logic of calculating of monthes remove the logic of months starting with september as M1 i wanna change it like this : 
i wanna make it when user create the emploi du temps then each emploi have independent starting and the starting will begin with the first presense and ending when the seances ends like this example :
when user create emploi du temps on august and that emploi du temps have 4 seances on month then the user comes to set the presences on september then its will start calculating from the first time of presence
and name it as M1 for that emploi du temps and the month will expire when user set the 4th presence of that emploi du temps that will close the M1 and starting directly with M2 with same logic 
make sure to apply this logic to application on the interface of presences and on the interface of dashboard and evrywhere on the application

fix the interface of dashboard remove the button  of quick access to 
Nouvel abonnement and payemnt for teacher and remove the creaion of expenses keep only the button of create new student make sure to make it when user click on it then make sure to make it open the interface of create new student of the interface of students on the side bare make it open on the same interface of dashboard and make possibility of user can create the student from it 

fix teh interface of dashboard make the design of display the emplois du temps of today make it better on a table and make sure to make it like this :
make it display on the first column the hour like from 8:00 to 10:00 and on the second column make it display the name of the emploi du temps and on the 3rd column make it display the salle anem of that emploi du temps and let user click on open to see the details of that emploi du tmeps 
first thing make sure to make the interface of open that emploi du tempa bigger and streamlined for the pc and moible and make sure to make it display the list of the students on table with possibilty of search about the studets with name or creation number and make button for create new student on that group make it open the interface of create new student that same interface of create new student on the interface of students and make it selcte by default this emploi du temps and make it can pay for sold of this emploi du temps with possibility of select another emploi on the sameinterface of create new sudent and let him save the student with ask him for print the payement or not 
 and make sure to make the students display on table with columns of the full name of the student and phone number the for the next columns make it display
for each seance from the seances number independet column with status of present or absent or canceled or empty means not yet 
then the next column make it display the statue of current month how much the current sold of that emploi du temps according to that student with button action for create new payment on the same column statue of this month that user can set new sold and when user create it make it ask him for print
make sure to make this column of currect statude of the current month display also the case of that student if its a son of teacher or the rest cases 
on next column make it display the statue of previous month if there is not debt make it display done imoji if there is debt let user click on it to see the details and to pay the debt and ask him for print after creation 
on next column make it for other debts make it display statue of other subscriptions of that student if there is debts and user can click on it to see the details and make it can click on them to pay the debt like the previouse statue 
on the last column make it for the set presence of that student for the currect seance of that date make it can make him presente without cofirmation when user make him present it its will minus the seance cost from his sold for that emploi du temps and change the statude of the column of that seance on the same table and if the user set the student absent then make the same let it minus the cost of seance from his sold with change the statue of that column seance on the same table and make sure to set condition on abssence make it that is the first seance of that student and he have not presented before on that emploi du temps then make it mark it as absent with do not minus the cost of that seance from his sold 
on the same column make it for cancel if user made that seance calceled for that student then make i mark the statue on that seanc on the same table and  do not minus from his sold
make sure to make option for return if the user hade wrong to make the presence or absence or calceling revocated and recover that sold that minus 
analyse the interface of presence on the side bare make sure to edit it like this treatement exacly make sure to make it run with same system this we will apply it on the interface dashboard
make sure to make the presence or absence or or cancel make it without cofirmations
andmake sure to make option of print the feuille presence when user complet to set all students and make sure to make it print the same table with same coloumn execp the buttons and make it nice template with informaitons of the school 
and make sure to apply this system on the interfaceo f prsence on the side bare with exactly the same treatement and same tabl and columns with keep the option of go to the previous months of M1 and M2 like this

fix the interface of seance libre on the side bare make itwhen user comes to create seance libre make it can seach about existing student or can type the full name for this sudent passager or can let it empty to save the seance as seance libre for student passager and make sure to let the user seach about the emploi du temps  that student studyed on it with name of emploi and make it display the price for one seance then let user validate the payment and create the seance libre and ask him for print the invoice and make it smal ans strealined 

apply this updates then push all updates to repo 


remove the quick access button on the login page and create on the login page button for create admin account with name and username and email and password and make sure to make the button of create new admin account hide when user create the admin account correctly 

analyse the application a deep analyse and give me the full sql code for this application make sure to remove all the constant data  to connect it with this supabase data base connection :
project url : https://jehpfbupmhbnbbkzhiwr.supabase.co

anon key : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplaHBmYnVwbWhibmJia3poaXdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzk5NzIsImV4cCI6MjEwMjY1NTk3Mn0.WkEp9gUnjPiztMPha5xUmvkP5lD17mt9eBXk9RrwBqI

make sure to make on the sql code all the table for all the interfaces and all the relations between the interfaces and make sure to make them contains all the button actions and make on the sql code the creation of the admin account from the login page and the creation of workers account and the creation of teachers account will create on the supabase authentification table and make sure to let all of them login to his session disrectly without problems 

make sure to connect all the interfaces and all the button action to make them use only the supabase data base connection 

