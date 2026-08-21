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



fix the creation of emploi du temps remove the requarement of remplire tous les champs and remove the option of requaremen on the creation for all the interfaces 
fix the interface of create new emploi du temps make it when user select more than one day for that emploi du temps then request from him to set the starting hour and ending hour of each day
change the logic of create new emploi du temps dont let the user select the salle until he select the days and the starting hour and the ending hour of each day then display for him the created sales that disponible on that day and hours or not disponible 




fix the groupe liste table that displaying from the dashboard make on it button for unsbscribe the student from that group

fix the creation of the students on the groupes on the dashboard or on the interface of sudents make sure to make the creation of the students on the current month and on the current seance for example we are on M2 on the seance 3 then i create new student on it then its will created on the M2 on the seance 3 and he will not be displayed exisiting on the previouse seances and the previous months 

fix the interface of teacher payement its not display what the teachers have to get pay analyse the application and make sure to fix the interface of teachers payement make sure to make it display only the monthes that not payed and make sure to make it display the students that did not pay to pass them pay on the next month and make sure to make it dipsplay the payement for each student according to his case on the creation and make sure to make this interface of payment display all the not payed monthes correctly and make the payements diaplay on the interface of view detaiels on the histoy and make possibiityo f print it 

fix the interface of edit button action interface make it display the exactly like the interface of create new student and let user can edit and save the edits 

fix the interface of dashboard on the first page that displaying the groupes make on it option for search and option for filtering by class and by year and by modul and by teacher and let user when seach or filtering make it display the groupe directly on the first one to click on it directly

fix the interface of see detailes button action interface of students make sure to app on the part of history of payements user can delete or edit the payment from the history 

make option on dashboard make it when user click on group on dashboard and make payement for the student on the group then make option for delete the payement onthe same page 

fix the payement of student that only pay for school make sure to make it calculate like this : 
for example we have emploi du temps contains 4 seances and  price is 2000 and the part of school is 800 and this student only pay for the school and dont pay for the teacher 
then make sure to make the seance price of that student is the price that will get the school (800 from 2000) divided by 4 ( the number of seances of that emploi du temps ) make sure to fix the payement of this type of students exactly like this 

fix the dashboard i got it display when students are payed for a months i got it display the amout that payed fromt aht students with minus make sure to fix it 

fix the interface of group that opening from the dashboard next to the button of create new student on that emploi du temps add new button for add new student existing on the data base on this emploi du temps let the user seach about it and add it on this emploi du temps to add it for his subscripitons without create it with all his personal informations because he is existing 

i got problem when i unsbscribe a student from an emploi du temps when i unsubscribe it from a group i got all informations of payements and preences and absences of that emploi get expired no make sure to make them still display on the history of that student and make sure to make it display the date of unsbscription 

create another shortcut on the interface of group that opening on the dashboard make it for make all students are present with possibility of searrch about student on the same interface 

apply this updates then push all updates to repo without pull request make it merge code directly 
then make sure to give me the sql code that i have to run it for this new updates 


fix the interface of dashboard make it display how much emploi du temps user did for it the present and how much emploi du temps rests on that day 

change the design of display the emplois du temps on the interface of dashboard make it better deisng and make each emploi with diffrent color 
and make the table dispaying like this : 
first column for timing for exammple from 8:00 to 10:00 
and for the next columns make it display the salles under it the emploi name for each time for that sale with possibility of click on each one to see the groupe detailes make sure to make this displaying timings on dashboard with better design and better organization and better colors

add button on the nave bare make it for hide and unhide the side bare

fix the interface of students create new button next to the button of students make it when user click on it then let him seach about a student with name or creation id number of phone number let him select it then when user select the student let it dispay all the emploi du temmps that student is subscribed on them let him select the emploi du temps and display for him the presenses of that month of that selected groupe and let it display how much have to pay that student 

create new button on the interface of seance libre on the side bare make it for create seance libre for group of students without set the names of the students just let the user search and select the teacher and let user set the date and the hour of starting and hour of ending and desciption about the name of this seance libre and let user type how much the total number of students and the price of the seance and how much will get the school and make it calculate how much will get the teacher from onw seance and make it calculate how much total price that will get the school and the teacher from this seance libre for this groupe when user create it ask him for print the fiche de pay for the teacher make sure to make it display all the details about it without display how much the school will get 
and make it display on the histoy of payement for that teacher 
and make button action for edit and delete and view details for this created seance libre for group and amek it if user edit or delete than its will edit or delete from the history of that teacher and from the caisse and repports interface 
make sure to make this informations of seance libre of group display also on the caisse interface and on the repports interface with all details 

fix the interface of dashboard create on it new button for shortcut create new deposit for the caisse make it exactly like the same interface of create new deposit of the interface of caisse on the side bare let user set the amount and the description and the date 
and make another button shorcut for create new expens on the same interface of dashboard and make another button also for create new withdrwal money from the cash

apply this updates then give me the sql code that i have to run for this new updates then push all updates to repo without pull request make sure to merge code directly to repo




fix the interface of payment of teacher 
change all the design of the interface make it when user click on it that will display for him a big table streamlined according to the device 
like the interface of openning of the groupes on the dashboard 
then make sure to make this interface of payment for the teacher exactly like the interface of presence on the interface of openning group on the dashboard make sure to make it exactly like that but make it organized by groupe for each groupe of that teacher and make it display for each student if he payed for this month or not and make on another column display if there is on previous month there is not payed seances and make it display also if there is some payments that student made them on the previous month but the teacher did not payed on it like this case : on m2 there is some student did not payed month and the admin create the payment of teacher on the month of m2 and after the payement of m2 that student comes to pay his debt of m2 then when admin comes to pay for the teacher on m3 then make it display the paymnet of that student of m2 and the m3 also 
and make sure to make on this interface of payment the special casses of students also : 
1st case if there is some student is his son then make sure to make it display it on special case on the end of the payment make it display how much his son studyed on that month and total amount and make it display if there is previous months not payed then make sure to make it calculate how much total have to pay for his son from his salary 
for the case student that pay to the school only and do not pay for the teacher then make sure to make it do not display on the interface of payment 
for the case of reduction of student case make sure to fix it for the payment for the school and for the interface of payment for the teacher make sure to make it calculate correctly from the original price then make it calculate correctly how much have to pay for the school after reduction and how much have to pay for teacher for reduction and make sure to make it display on the interface of payment of teacher on the case of special casses
then on the same interface of payement of teacher make it dsiplay another table display the expenses liste of that teacher and make it calculate the total and make it dispay the total of students and minus from it the expensses and the acompes then display the total that have to get pay 
and let user create the payement and when user create it ask him for print it 
make sure to make it display the informations of school with logo and informations of teacher and the table of all that payment for students and table of expensses and all details about the payment and make it display with nice organisation and make it with nice design 
make sure to focus on the amount that have to pay teacher for each student and for each groupe for that teacher make it calculate correctly the amount that have to get pay teacher from the price calculated for each seance on the creation of that groupes that assigned to them that teacher 

fix the interface of create new emploi du temps make option for seach about the teacher from his name and let user select it

fix the interface of create new emploi du temps make when user comes to create new salle then its will not let the user create another salle with same name 

fix the interface of create new emploi du temps make it if the user select more then one day then let him select the salle for each day 

fix the interface of edit student make it when user click on edit student then make it load all informations of that student and the same for the part of inscription and the class and the year and inscriptions of that student and let the user can select more emploi du temps and can unselect the currrent 

fix the interface of dashboard if the student pay more that the cost of the subscription like the cost is 1800 and the student payed 2000 then let him calculate the rest and save it for the solde for that emploi du temps that will display it after how much currect sold of the student for that emploi du temps 

fix the interface of openning groupe make another button make if for make all the seance canceled for all the students 

create new button on the dashboard make it for situation student make it when user click on it then let him search about the student with name or phone number of creation number let the user select it to display for him a table exacty like the table of open group from the interface of dashboard 
make this table display all emploi du temps of that student and the statue of the currect mont if payed or not with possibility of create payment on the same interface and make user can go to the previous months to see the statue of the previous months and can create payement for them also 

